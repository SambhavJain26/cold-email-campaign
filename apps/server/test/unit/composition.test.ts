import { describe, expect, it } from 'vitest';
import { compose } from '../../src/composition';
import { parseEnv } from '../../src/config/env';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import { SmtpImapTransport } from '../../src/transport/smtpImap/smtpImapTransport';

function testConfig(over: Record<string, string> = {}) {
  const r = parseEnv({
    DATABASE_URL: 'postgres://coldemail:pw@localhost:5433/coldemail',
    SECRET_KEY: 'a'.repeat(64),
    SESSION_KEY: 'b'.repeat(64),
    OPERATOR_EMAIL: 'op@example.com',
    OPERATOR_INITIAL_PASSWORD: 'longenough',
    ...over,
  });
  if (!r.success) throw new Error(r.issues.join('; '));
  return r.config;
}

describe('compose', () => {
  it('defaults to SystemClock and the real MockTransport (MAIL_TRANSPORT=mock)', async () => {
    const services = compose(testConfig());
    expect(Math.abs(services.clock.now().getTime() - Date.now())).toBeLessThan(1000);
    expect(services.transport).toBeInstanceOf(MockTransport);
    await expect(services.transport.fetchNew(1)).resolves.toEqual([]);
    // the full worker graph is composed too
    expect(services.scheduler).toBeDefined();
    expect(services.poller).toBeDefined();
    expect(services.jobs).toBeDefined();
  });

  it('accepts overrides — the seam tests use for VirtualClock + scripted transports', () => {
    const clock = new VirtualClock('2026-06-01T00:00:00Z');
    const services = compose(testConfig(), { clock });
    expect(services.clock.now().toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  // ── B8.2: the one switch that goes live (docs/16 §1) ───────────────────────

  it('MAIL_TRANSPORT=smtp_imap composes the LIVE transport — the whole go-live diff', () => {
    const services = compose(testConfig({ MAIL_TRANSPORT: 'smtp_imap' }));
    expect(services.transport).toBeInstanceOf(SmtpImapTransport);
    // Same MailTransport surface — nothing downstream can tell which is active.
    for (const method of ['send', 'fetchNew', 'verify'] as const) {
      expect(typeof services.transport[method]).toBe('function');
    }
    // …and the rest of the graph is composed exactly as in mock mode.
    expect(services.scheduler).toBeDefined();
    expect(services.poller).toBeDefined();
    expect(services.jobs).toBeDefined();
    expect(services.simulation).toBeUndefined(); // scripting is mock-only
  });

  it('flipping the flag back is symmetric — mock mode is unchanged by B8', () => {
    expect(compose(testConfig({ MAIL_TRANSPORT: 'mock' })).transport).toBeInstanceOf(MockTransport);
    expect(compose(testConfig({ MAIL_TRANSPORT: 'smtp_imap' })).transport).toBeInstanceOf(
      SmtpImapTransport,
    );
  });

  it('a test override still wins over the flag (offline suites stay offline)', () => {
    const transport = new MockTransport(new VirtualClock('2026-06-01T00:00:00Z'));
    const services = compose(testConfig({ MAIL_TRANSPORT: 'smtp_imap' }), { transport });
    expect(services.transport).toBe(transport);
  });
});
