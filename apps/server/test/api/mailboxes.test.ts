// B6.2 — mailbox routes: CRUD, secret sealing, test-connection, pause/resume,
// reconnect, volume. Mailbox mutations append NO events (docs/10 traceability).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { VirtualClock } from '../../src/clock/virtual';
import { getMailbox, getMailboxSecret, patchMailbox } from '../../src/db/repos/mailboxesRepo';
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
    const res = await h.inject({
      method: 'PATCH',
      url: '/api/v1/mailboxes/1',
      payload: { daily_cap: 40, password: 'rotated-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().daily_cap).toBe(40);
    const sealed = await getMailboxSecret(h.services.db, 1);
    expect(await unsealSecret(sealed!, h.config.SECRET_KEY)).toBe('rotated-password');

    expect(
      (await h.inject({ method: 'PATCH', url: '/api/v1/mailboxes/999', payload: {} })).statusCode,
    ).toBe(404);
  });

  it('test-connection returns the transport verify result', async () => {
    const ok = await h.inject({ method: 'POST', url: '/api/v1/mailboxes/1/test-connection' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ smtp_ok: true, imap_ok: true, round_trip_ms: 42 });

    transport.onVerify('sarah@agency.dev', { smtpOk: true, imapOk: false, error: 'IMAP refused' });
    const bad = await h.inject({ method: 'POST', url: '/api/v1/mailboxes/1/test-connection' });
    expect(bad.json()).toEqual({ smtp_ok: true, imap_ok: false });
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

  it('volume returns per-mailbox series + imbalance boolean', async () => {
    const res = await h.inject({ method: 'GET', url: '/api/v1/mailboxes/volume?days=30' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ items: [], imbalance: false }); // no sends yet
  });
});
