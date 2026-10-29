// B6.2 — mailbox routes: CRUD, secret sealing, test-connection, pause/resume,
// reconnect, volume. Mailbox mutations append NO events (docs/10 traceability).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { VirtualClock } from '../../src/clock/virtual';
import { getMailbox, getMailboxSecret, patchMailbox } from '../../src/db/repos/mailboxesRepo';
import { getCursor, setCursor } from '../../src/db/repos/pollCursorsRepo';
import { unsealSecret } from '../../src/secrets/seal';
import { createApiHarness, type ApiHarness } from './helpers/app';
import { eventWatermark, expectNoNewEvents } from './helpers/events';

const CREATE_BODY = {
  display_name: 'Sarah',
  from_address: 'sarah@agency.dev',
  smtp_host: 'smtp.agency.dev',
  smtp_port: 587,
  imap_host: 'imap.agency.dev',
  imap_port: 993,
  auth_type: 'app_password',
  password: 'super-secret-app-password',
  daily_cap: 30,
  send_window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
};

describe('B6.2 mailboxes', () => {
  let h: ApiHarness;
  let transport: MockTransport;

  beforeAll(async () => {
    const clock = new VirtualClock();
    transport = new MockTransport(clock);
    h = await createApiHarness({ clock, transport });
  });
  afterAll(async () => {
    await h.close();
  });

  it('creates a mailbox: password sealed at rest, absent from the response', async () => {
    const wm = await eventWatermark(h.pool);
    const res = await h.inject({ method: 'POST', url: '/api/v1/mailboxes', payload: CREATE_BODY });
    expect(res.statusCode).toBe(200);
    const dto = res.json();
    expect(dto.display_name).toBe('Sarah');
    expect(dto.effective_cap).toBe(30);
    expect(dto.status).toBe('ok');
    expect(dto.sent_today).toBe(0);
    expect(JSON.stringify(dto)).not.toContain('super-secret-app-password');
    expect(dto.password).toBeUndefined();

    // sealed at rest: bytes stored, not plaintext; unseal round-trips
    const sealed = await getMailboxSecret(h.services.db, dto.id);
    expect(sealed).not.toBeNull();
    expect(sealed!.toString('utf8')).not.toContain('super-secret-app-password');
    expect(await unsealSecret(sealed!, h.config.SECRET_KEY)).toBe('super-secret-app-password');

    await expectNoNewEvents(h.pool, wm); // mailboxes row in the traceability table: none
  });

  it('lists mailboxes with stats fields', async () => {
    const res = await h.inject({ method: 'GET', url: '/api/v1/mailboxes' });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      from_address: 'sarah@agency.dev',
      sent_today: 0,
      hard_bounce_pct: 0,
      seven_day_avg: 0,
      last_successful_poll_at: null,
    });
  });

  it('PATCH updates a subset; password re-seal is optional', async () => {
    const wm = await eventWatermark(h.pool);
    for (const value of [0, -1, 1.5, 1441, null]) {
      const invalid = await h.inject({
        method: 'PATCH',
        url: '/api/v1/mailboxes/1',
        payload: { send_interval_minutes: value },
      });
      expect(invalid.statusCode).toBe(400);
    }
    const spaced = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { send_interval_minutes: 4 },
    });
    expect(spaced.statusCode).toBe(200);
    expect(spaced.json()).toMatchObject({ send_interval_minutes: 4, daily_cap: 30 });
    await expectNoNewEvents(h.pool, wm);
    const res = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { daily_cap: 40, password: 'rotated-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().daily_cap).toBe(40);
    expect(res.json().send_interval_minutes).toBe(4);
    const sealed = await getMailboxSecret(h.services.db, 1);
    expect(await unsealSecret(sealed!, h.config.SECRET_KEY)).toBe('rotated-password');

    expect(
      (await h.inject({ method: 'PATCH', url: '/api/v1/mailboxes/999', payload: {} })).statusCode,
    ).toBe(404);
  });

  it('canonicalizes the Calcutta alias before PostgreSQL stores or queries it', async () => {
    const res = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { timezone: 'Asia/Calcutta' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().timezone).toBe('Asia/Kolkata');
    expect((await getMailbox(h.services.db, 1))!.timezone).toBe('Asia/Kolkata');
  });

  it('test-connection returns the transport verify result', async () => {
    const ok = await h.inject({ method: 'POST', url: '/api/v1/mailboxes/1/test-connection' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      smtp_ok: true,
      imap_ok: true,
      round_trip_ms: 42,
      folders: [{ name: 'INBOX', exists: true, special_use: '\\Inbox' }],
    });

    transport.onVerify('sarah@agency.dev', { smtpOk: true, imapOk: false, error: 'IMAP refused' });
    const bad = await h.inject({ method: 'POST', url: '/api/v1/mailboxes/1/test-connection' });
    expect(bad.json()).toEqual({
      smtp_ok: true,
      imap_ok: false,
      folders: [{ name: 'INBOX', exists: false, special_use: null }],
    });
  });

  it('discovers folders, rejects typos, and seeds each newly selected folder at UIDNEXT', async () => {
    transport.onFolders('sarah@agency.dev', [
      { name: 'INBOX', specialUse: '\\Inbox' },
      { name: 'Junk', specialUse: '\\Junk' },
    ]);
    transport.setInitialPollUid('sarah@agency.dev', 77);
    const discovered = await h.inject({ method: 'GET', url: '/api/v1/mailboxes/1/folders' });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().items).toEqual([
      { name: 'INBOX', special_use: '\\Inbox' },
      { name: 'Junk', special_use: '\\Junk' },
    ]);

    const typo = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { poll_folders: ['INBOX', 'Jnuk'] },
    });
    expect(typo.statusCode).toBe(422);
    expect((await getMailbox(h.services.db, 1))!.pollFolders).toEqual(['INBOX']);

    const saved = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { poll_folders: ['INBOX', 'Junk'] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().poll_folders).toEqual(['INBOX', 'Junk']);
    expect(await getCursor(h.services.db, 1, 'Junk')).toBe(77);
  });

  it('pause → paused; resume from operator pause returns to full cap', async () => {
    const paused = await h.inject({ method: 'POST', url: '/api/v1/mailboxes/1/pause' });
    expect(paused.json().status).toBe('paused');

    const resumed = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes/1/resume',
      payload: {},
    });
    expect(resumed.json().status).toBe('ok');
    expect(resumed.json().effective_cap).toBe(40); // 100% of daily_cap
  });

  it('resume from auto_paused defaults to 50% cap', async () => {
    await patchMailbox(h.services.db, 1, {
      status: 'auto_paused',
      statusReason: 'auto-pause (absolute)',
    });
    const res = await h.inject({ method: 'POST', url: '/api/v1/mailboxes/1/resume', payload: {} });
    expect(res.json().status).toBe('ok');
    expect(res.json().effective_cap).toBe(20); // 50% of 40
  });

  it('auto-pause resume honors saved percentages and explicit overrides without changing history', async () => {
    const wm = await eventWatermark(h.pool);
    const original = await h.pool.query('SELECT resume_cap_pct FROM settings WHERE id=1');
    try {
      for (const pct of [100, 75, 1]) {
        await h.pool.query('UPDATE settings SET resume_cap_pct=$1 WHERE id=1', [pct]);
        await patchMailbox(h.services.db, 1, { status: 'auto_paused' });
        const res = await h.inject({
          method: 'POST',
          url: '/api/v1/mailboxes/1/resume',
          payload: {},
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
          status: 'ok',
          daily_cap: 40,
          effective_cap: Math.max(1, Math.floor((40 * pct) / 100)),
        });
      }
      await patchMailbox(h.services.db, 1, { status: 'auto_paused' });
      const explicit = await h.inject({
        method: 'POST',
        url: '/api/v1/mailboxes/1/resume',
        payload: { cap_pct: 75 },
      });
      expect(explicit.statusCode).toBe(200);
      expect(explicit.json().effective_cap).toBe(30);
      for (const cap_pct of [0, 101, 50.5]) {
        const invalid = await h.inject({
          method: 'POST',
          url: '/api/v1/mailboxes/1/resume',
          payload: { cap_pct },
        });
        expect(invalid.statusCode).toBe(400);
      }
      await expectNoNewEvents(h.pool, wm);
    } finally {
      await h.pool.query('UPDATE settings SET resume_cap_pct=$1 WHERE id=1', [
        original.rows[0].resume_cap_pct,
      ]);
    }
  });

  it('reconnect re-seals and flips auth_failed → ok on verified creds', async () => {
    await patchMailbox(h.services.db, 1, { status: 'auth_failed', statusReason: 'IMAP auth' });
    transport.onVerify('sarah@agency.dev', { smtpOk: true, imapOk: true, roundTripMs: 10 });
    const res = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes/1/reconnect',
      payload: { password: 'fresh-password' },
    });
    expect(res.json().status).toBe('ok');
    const sealed = await getMailboxSecret(h.services.db, 1);
    expect(await unsealSecret(sealed!, h.config.SECRET_KEY)).toBe('fresh-password');

    // failed verify keeps auth_failed
    await patchMailbox(h.services.db, 1, { status: 'auth_failed', statusReason: 'IMAP auth' });
    transport.onVerify('sarah@agency.dev', { smtpOk: false, imapOk: false, error: 'nope' });
    const still = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes/1/reconnect',
      payload: { password: 'still-bad' },
    });
    expect(still.json().status).toBe('auth_failed');
    const row = await getMailbox(h.services.db, 1);
    expect(row!.status).toBe('auth_failed');
    await patchMailbox(h.services.db, 1, { status: 'ok', statusReason: null });
  });

  it('registers the poll job for mailboxes created or recovered at runtime', async () => {
    // Boot only registers the mailboxes that exist at boot (and skips
    // auth_failed ones), so without these calls a mailbox added through the UI
    // is never polled until the process restarts — its replies, bounces and
    // STOPs stay invisible.
    const register = vi.spyOn(h.services.jobs, 'registerMailboxPoll').mockResolvedValue(undefined);
    try {
      const created = await h.inject({
        method: 'POST',
        url: '/api/v1/mailboxes',
        payload: { ...CREATE_BODY, from_address: 'poll-me@agency.dev' },
      });
      expect(created.statusCode).toBe(200);
      expect(register).toHaveBeenCalledWith(created.json().id);

      // A recovered auth_failed mailbox also needs (re-)registering.
      register.mockClear();
      await patchMailbox(h.services.db, 1, { status: 'auth_failed', statusReason: 'IMAP auth' });
      transport.onVerify('sarah@agency.dev', { smtpOk: true, imapOk: true });
      const reconnected = await h.inject({
        method: 'POST',
        url: '/api/v1/mailboxes/1/reconnect',
        payload: { password: 'fresh-password' },
      });
      expect(reconnected.json().status).toBe('ok');
      expect(register).toHaveBeenCalledWith(1);
    } finally {
      register.mockRestore();
    }
  });

  it('initializes a new or legacy-zero IMAP cursor without replacing a nonzero cursor', async () => {
    transport.setInitialPollUid('cursor@agency.dev', 55);
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes',
      payload: { ...CREATE_BODY, from_address: 'cursor@agency.dev' },
    });
    // Since 0012 the cursor lives per (mailbox, folder) — IMAP UIDs are
    // folder-scoped, so there is no single mailbox-wide mark to assert on.
    const cursorId = created.json().id as number;
    expect(await getCursor(h.services.db, cursorId, 'INBOX')).toBe(55);

    // A reconnect seeds only folders with NO cursor yet. It must not discard
    // messages that arrived while a real mailbox was temporarily unavailable.
    await h.pool.query(`DELETE FROM mailbox_poll_cursors WHERE mailbox_id = 1`);
    transport.setInitialPollUid('sarah@agency.dev', 72);
    await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes/1/reconnect',
      payload: { password: 'fresh-password' },
    });
    expect(await getCursor(h.services.db, 1, 'INBOX')).toBe(72);
    await setCursor(h.services.db, 1, 'INBOX', 73);
    transport.setInitialPollUid('sarah@agency.dev', 99);
    await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes/1/reconnect',
      payload: { password: 'fresh-password' },
    });
    // Unchanged: a nonzero cursor is never overwritten by a reconnect.
    expect(await getCursor(h.services.db, 1, 'INBOX')).toBe(73);
  });

  it('volume returns per-mailbox series + imbalance boolean', async () => {
    const res = await h.inject({ method: 'GET', url: '/api/v1/mailboxes/volume?days=30' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imbalance).toBe(false);
    expect(body.items).toHaveLength(3);
    expect(body.items.every((item: { series: unknown[] }) => item.series.length === 30)).toBe(true);
    expect(
      body.items.every((item: { series: Array<{ sends: number }> }) =>
        item.series.every((point) => point.sends === 0),
      ),
    ).toBe(true);
  });
});
