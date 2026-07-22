import { describe, expect, it } from 'vitest';
import { VirtualClock, durationMs } from '../../src/clock/virtual';

describe('VirtualClock', () => {
  it('starts at the given time and returns defensive copies', () => {
    const c = new VirtualClock('2026-03-01T09:00:00Z');
    const a = c.now();
    a.setFullYear(1999); // mutating the returned Date must not affect the clock
    expect(c.now().toISOString()).toBe('2026-03-01T09:00:00.000Z');
  });

  it('advances by compound durations', () => {
    const c = new VirtualClock('2026-03-01T09:00:00Z');
    c.advance({ days: 3, hours: 2, minutes: 30 });
    expect(c.now().toISOString()).toBe('2026-03-04T11:30:00.000Z');
  });

  it('refuses to move backwards', () => {
    const c = new VirtualClock('2026-03-01T09:00:00Z');
    expect(() => c.set('2026-02-28T00:00:00Z')).toThrow(/backwards/);
  });

  it('stepTo fires the callback per increment and lands exactly on target', async () => {
    const c = new VirtualClock('2026-03-01T00:00:00Z');
    const seen: string[] = [];
    // 23h in 5h steps -> 4 full steps + a final partial 3h step
    await c.stepTo('2026-03-01T23:00:00Z', { hours: 5 }, (now) => {
      seen.push(now.toISOString());
    });
    expect(seen).toHaveLength(5);
    expect(seen[0]).toBe('2026-03-01T05:00:00.000Z');
    expect(seen[3]).toBe('2026-03-01T20:00:00.000Z');
    expect(seen.at(-1)).toBe('2026-03-01T23:00:00.000Z');
    expect(c.now().toISOString()).toBe('2026-03-01T23:00:00.000Z');
  });

  it('a simulated 49-day campaign fast-forward completes instantly', async () => {
    const c = new VirtualClock('2026-01-05T08:00:00Z');
    let ticks = 0;
    const start = Date.now();
    // 5-minute scheduler tick over 49 days = 14,112 callbacks
    await c.stepTo('2026-02-23T08:00:00Z', { minutes: 5 }, () => {
      ticks += 1;
    });
    expect(ticks).toBe((49 * 24 * 60) / 5);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('durationMs composes units correctly', () => {
    expect(durationMs({ days: 1, hours: 1, minutes: 1, seconds: 1, ms: 1 })).toBe(90_061_001);
  });
});
