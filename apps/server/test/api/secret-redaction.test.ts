// B7.1 — the security-checklist tripwire (docs/16 §6): no secret material in
// logs. Runs the real app over the secret-handling routes (seal on create,
// unseal on test-connection, re-seal on reconnect) with the logger cranked to
// `trace` and every line captured, then greps the whole stream for sentinels.
// Also proves the two supporting guarantees: the logger censors a secret even
// when one is handed to it, and what lands in the DB is ciphertext, not the
// plaintext password.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { VirtualClock } from '../../src/clock/virtual';
import { unsealSecret } from '../../src/secrets/seal';
import { createApiHarness, TEST_OPERATOR, type ApiHarness } from './helpers/app';

// Distinctive, greppable plaintext — nothing else in the codebase looks like this.
const CREATE_PW = 'SENTINEL-create-pw-9f3a1c';
const RECONNECT_PW = 'SENTINEL-reconnect-pw-4b7e2d';

const CREATE_BODY = {
  display_name: 'Sarah',
  from_address: 'sarah@agency.dev',
  smtp_host: 'smtp.agency.dev',
  smtp_port: 587,
  imap_host: 'imap.agency.dev',
  imap_port: 993,
  auth_type: 'app_password',
  password: CREATE_PW,
  daily_cap: 30,
  send_window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
};

describe('B7.1 no secret material in logs', () => {
  let h: ApiHarness;
  const lines: string[] = [];

  beforeAll(async () => {
    const clock = new VirtualClock();
    const transport = new MockTransport(clock);
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    // trace = the most verbose the app ever logs; if a secret leaks anywhere,
    // it leaks here.
    h = await createApiHarness({ clock, transport }, {}, { destination, level: 'trace' });

    // Exercise every route that touches a secret. login() also runs here
    // (inject logs in on first use), so the operator password flows too.
    const created = await h.inject({
      method: 'POST',
      url: '/api/v1/mailboxes',
      payload: CREATE_BODY,
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;

    await h.inject({ method: 'POST', url: `/api/v1/mailboxes/${id}/test-connection` });
    await h.inject({
      method: 'POST',
      url: `/api/v1/mailboxes/${id}/reconnect`,
      payload: { password: RECONNECT_PW },
    });

    // Defense-in-depth: hand the logger a secret-bearing object directly and
    // confirm the redactor censors it (proves the grep below isn't passing
    // merely because nothing ever reached the logger).
    h.app.log.error(
      { password: CREATE_PW, mailbox: { app_password: RECONNECT_PW }, note: 'deliberate' },
      'deliberate secret payload',
    );
  });

  afterAll(async () => {
    await h.close();
  });

  it('captured a non-trivial log stream (guards against a vacuous pass)', () => {
    expect(lines.length).toBeGreaterThan(0);
    // the redactor demonstrably fired on the deliberate payload
    expect(lines.join('\n')).toContain('[REDACTED]');
  });

  it('never emits any secret plaintext across the whole run', () => {
    const blob = lines.join('\n');
    expect(blob).not.toContain(CREATE_PW);
    expect(blob).not.toContain(RECONNECT_PW);
    expect(blob).not.toContain(TEST_OPERATOR.password);
    expect(blob).not.toContain(h.config.SECRET_KEY);
    expect(blob).not.toContain(h.config.SESSION_KEY);
  });

  it('stores ciphertext at rest, not the plaintext password', async () => {
    const { rows } = await h.pool.query<{ sealed: Buffer }>(
      'SELECT sealed FROM mailbox_secrets ORDER BY mailbox_id LIMIT 1',
    );
    const sealed = rows[0]!.sealed;
    // last write was reconnect → sealed holds RECONNECT_PW, but not in the clear
    expect(sealed.includes(Buffer.from(RECONNECT_PW, 'utf8'))).toBe(false);
    expect(sealed.includes(Buffer.from(CREATE_PW, 'utf8'))).toBe(false);
    expect(await unsealSecret(sealed, h.config.SECRET_KEY)).toBe(RECONNECT_PW);
  });
});
