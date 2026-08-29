// B3.18 edge suite (docs/06 §8) — the cases not already locked by the
// scheduler/poller/health suites: never-burst catch-up after downtime,
// local-midnight cap reset, rotation balance.
import { afterEach, describe, expect, it } from 'vitest';
import { scenario, leadEmail, type Scenario } from '../helpers/scenario';
import { localParts } from '../../src/scheduler/window';
import { testSequence } from '../helpers/sequences';

const oneStep = testSequence(1, [0]);

describe('scheduler edges (B3.18)', () => {
  let s: Scenario;
  afterEach(async () => {
    await s.close();
  });

  it('never-burst catch-up: a downtime backlog drains oldest-first at ≤ cap/day, one catchup alert', async () => {
    s = await scenario({
      mailboxes: 1,
      dailyCap: 5,
      sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '17:00' },
      sequence: oneStep,
      tickMinutes: 30,
    });
    await s.importLeads(12);

    // Downtime: enroll in three waves with the scheduler OFF, so overdue
    // next_send_at values age in enrollment order.
    const realTick = s.hooks.tick;
    s.hooks.tick = undefined;
    await s.enroll({ count: 4 });
    await s.advanceHours(5);
    await s.enroll({ count: 4 });
    await s.advanceHours(5);
    await s.enroll({ count: 4 });
    await s.advanceHours(14); // 14h gap — scheduler completely down

    // Restart. No special mode: oldest-first + budgets IS the catch-up.
    s.hooks.tick = realTick;
    await s.advanceHours(24);
    const day1 = s.mock.sentLog.filter((e) => e.result.accepted);
    expect(day1.length).toBe(5); // never-burst: capped despite 12 overdue
    // oldest overdue first = enrollment order = lead id order
    expect(day1.map((e) => e.msg.to)).toEqual([1, 2, 3, 4, 5].map((i) => leadEmail(`L${i}`)));

    // one catchup_backlog alert for the whole episode, not one per tick
    expect(s.alerts.emitted.filter((a) => a.kind === 'catchup_backlog')).toHaveLength(1);

    await s.advanceHours(24);
    expect(s.mock.sentLog.filter((e) => e.result.accepted).length).toBe(10);
    await s.advanceHours(24);
    expect(s.mock.sentLog.filter((e) => e.result.accepted).length).toBe(12); // drained

    // per-local-day cap held throughout
    const perDay = new Map<string, number>();
    for (const e of s.mock.sentLog.filter((x) => x.result.accepted)) {
      const p = localParts(e.at, 'America/New_York');
      const key = `${p.year}-${p.month}-${p.day}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    for (const [day, n] of perDay) expect(n, day).toBeLessThanOrEqual(5);
  }, 60_000);

  it('caps count against OPERATOR-local (ET) days — sends spanning UTC midnight stay in one budget', async () => {
    s = await scenario({
      mailboxes: 1,
      dailyCap: 3,
      // window reaches past UTC midnight in ET terms (23:59 ET = 04:59Z next UTC day)
      sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '23:59' },
      sequence: oneStep,
      tickMinutes: 30,
      jitterPct: 0,
    });
    await s.importLeads(6);
    await s.enroll({ count: 6 });

    // Pace gap = 959/3 ≈ 320 min → sends ~13:30Z, ~19:00Z, ~00:30Z(Tue UTC) —
    // the third lands PAST UTC midnight but still on Monday in ET.
    await s.advanceHours(15); // → Tue 04:00Z = Mon 23:00 ET
    const monday = s.mock.sentLog.filter((e) => e.result.accepted);
    expect(monday).toHaveLength(3); // full budget used within ONE ET day
    expect(localParts(monday.at(-1)!.at, 'America/New_York').day).toBe(5); // still Jan 5 ET

    await s.advanceHours(24); // Tuesday's ET window
    const all = s.mock.sentLog.filter((e) => e.result.accepted);
    expect(all).toHaveLength(6);

    const perEtDay = new Map<number, number>();
    for (const e of all) {
      const p = localParts(e.at, 'America/New_York');
      perEtDay.set(p.day, (perEtDay.get(p.day) ?? 0) + 1);
    }
    expect([...perEtDay.values()]).toEqual([3, 3]); // exactly cap per LOCAL day
  }, 60_000);

  it('rotation balance: 4 equal mailboxes end within ±1 send of each other', async () => {
    s = await scenario({
      mailboxes: 4,
      dailyCap: 30,
      sequence: oneStep,
      tickMinutes: 5,
      jitterPct: 0, // equal cadence — rotation alone decides the spread
      seed: 99,
      steadyDailyEnrollCap: 40,
    });
    await s.importLeads(40);
    await s.enroll({ count: 40 });

    await s.advanceHours(9);

    const counts = [1, 2, 3, 4].map(
      (mb) => s.mock.sentLog.filter((e) => e.result.accepted && e.msg.mailboxId === mb).length,
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(40);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  }, 60_000);
});
