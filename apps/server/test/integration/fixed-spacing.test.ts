import { afterEach, describe, expect, it } from 'vitest';
import { scenario, type Scenario } from '../helpers/scenario';
import { testSequence } from '../helpers/sequences';

describe('operator-controlled send intervals', () => {
  let s: Scenario;
  afterEach(async () => {
    await s?.close();
  });

  it.each([20, 25])(
    'uses four-minute spacing and stops at %i/day without stretching the window',
    async (cap) => {
      s = await scenario({
        mailboxes: 4,
        dailyCap: cap,
        steadyDailyEnrollCap: 200,
        sequence: testSequence(1, [0, 3]),
        tickMinutes: 1,
        jitterPct: 50,
        start: '2026-10-06T13:00:00Z',
        sendWindow: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
      });
      await s.pool.query('UPDATE mailboxes SET send_interval_minutes=4');
      await s.importLeads(cap * 4 + 4);
      await s.enroll({ count: cap * 4 + 4 });
      await s.scheduler.tick();
      await s.advanceHours(2);
      const accepted = s.mock.sentLog.filter((entry) => entry.result.accepted);
      expect(accepted).toHaveLength(cap * 4);
      for (let mailboxId = 1; mailboxId <= 4; mailboxId++) {
        const messages = accepted.filter((entry) => entry.msg.mailboxId === mailboxId);
        expect(messages).toHaveLength(cap);
        for (let i = 1; i < messages.length; i++) {
          expect(messages[i]!.at.getTime() - messages[i - 1]!.at.getTime()).toBe(4 * 60_000);
        }
      }
      await s.scheduler.tick();
      expect(s.mock.sentLog.filter((entry) => entry.result.accepted)).toHaveLength(cap * 4);
      s.clock.set('2026-10-07T12:59:00Z');
      // The virtual clock jump skips normal minute poll jobs. Poll through
      // the mock transport so mailboxes do not become IMAP-stale in this fixture.
      for (let mailboxId = 1; mailboxId <= 4; mailboxId++) {
        await s.hooks.poll?.(mailboxId, s.clock.now());
      }
      await s.scheduler.tick();
      expect(s.mock.sentLog.filter((entry) => entry.result.accepted)).toHaveLength(cap * 4);
      s.clock.set('2026-10-07T13:00:00Z');
      await s.scheduler.tick();
      expect(s.mock.sentLog.filter((entry) => entry.result.accepted)).toHaveLength(cap * 4 + 4);
    },
    60_000,
  );

  it('does not burst after downtime, honors resume caps, and spaces from the last accepted send after an interval change', async () => {
    s = await scenario({
      mailboxes: 1,
      dailyCap: 25,
      sequence: testSequence(1, [0, 3]),
      tickMinutes: 1,
      start: '2026-10-06T13:00:00Z',
    });
    await s.pool.query('UPDATE mailboxes SET send_interval_minutes=4,resume_cap=2');
    await s.importLeads(5);
    await s.enroll({ count: 5 });
    await s.scheduler.tick();
    await s.pool.query('UPDATE mailboxes SET send_interval_minutes=10');
    s.clock.advance({ minutes: 4 });
    expect((await s.scheduler.tick()).sent).toBe(0);
    s.clock.advance({ hours: 1 });
    expect((await s.scheduler.tick()).sent).toBe(1);
    expect((await s.scheduler.tick()).sent).toBe(0);
    expect(s.mock.sentLog.filter((entry) => entry.result.accepted)).toHaveLength(2);
  });
});
