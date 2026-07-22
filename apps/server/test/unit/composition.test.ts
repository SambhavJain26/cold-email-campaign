import { describe, expect, it } from 'vitest';
import { compose } from '../../src/composition';
import { parseEnv } from '../../src/config/env';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';

function testConfig() {
  const r = parseEnv({
    DATABASE_URL: 'postgres://coldemail:pw@localhost:5433/coldemail',
    SECRET_KEY: 'a'.repeat(64),
    SESSION_KEY: 'b'.repeat(64),
    OPERATOR_EMAIL: 'op@example.com',
    OPERATOR_INITIAL_PASSWORD: 'longenough',
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

  it('accepts overrides - the seam tests use for VirtualClock + scripted transports', () => {
    const clock = new VirtualClock('2026-06-01T00:00:00Z');
    const services = compose(testConfig(), { clock });
    expect(services.clock.now().toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});
