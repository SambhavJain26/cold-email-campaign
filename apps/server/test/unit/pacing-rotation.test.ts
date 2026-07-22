// B3.6: pacing math (decision P) + opener rotation (docs/06 §§2–3).
import { describe, expect, it } from 'vitest';
import { jitterFactor, minGapMs, paceReady } from '../../src/scheduler/pacing';
import { pickMailbox, type RotationCandidate } from '../../src/scheduler/rotation';
import { seededRng } from '../../src/util/rng';
import type { SendWindow } from '../../src/db/schema/transport';

const window9h: SendWindow = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };

describe('pacing (decision P)', () => {
  it('minGap = window / cap — the spec example: 540 min / 30 = 18 min', () => {
    expect(minGapMs(window9h, 30)).toBe(18 * 60_000);
  });

  it('zero/negative cap can never be pace-ready', () => {
    expect(minGapMs(window9h, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('jitterFactor stays within ±pct and is deterministic from the seed', () => {
    const rng = seededRng(7);
    const factors = Array.from({ length: 1000 }, () => jitterFactor(rng, 20));
    for (const f of factors) {
      expect(f).toBeGreaterThanOrEqual(0.8);
      expect(f).toBeLessThanOrEqual(1.2);
    }
    const rng2 = seededRng(7);
    expect(jitterFactor(rng2, 20)).toBe(factors[0]);
  });

  it('paceReady: never-sent is ready; otherwise gap must have elapsed', () => {
    const now = new Date('2026-01-05T15:00:00Z');
    expect(paceReady(now, null, 18 * 60_000)).toBe(true);
    expect(paceReady(now, new Date('2026-01-05T14:50:00Z'), 18 * 60_000)).toBe(false);
    expect(paceReady(now, new Date('2026-01-05T14:42:00Z'), 18 * 60_000)).toBe(true); // exactly 18m
  });
});

describe('rotation pickMailbox (docs/06 §3)', () => {
  const c = (
    id: number,
    sentToday: number,
    capToday: number,
    lastSendAt: Date | null = null,
    budget = capToday - sentToday,
  ): RotationCandidate => ({ id, sentToday, capToday, budget, lastSendAt });

  it('picks the lowest sentToday/capToday ratio', () => {
    const picked = pickMailbox([c(1, 10, 30), c(2, 5, 30), c(3, 20, 30)], seededRng(1));
    expect(picked!.id).toBe(2);
  });

  it('ratio ties break by least-recent last_send_at (null = least recent)', () => {
    const t1 = new Date('2026-01-05T14:00:00Z');
    const t2 = new Date('2026-01-05T15:00:00Z');
    expect(pickMailbox([c(1, 5, 30, t2), c(2, 5, 30, t1)], seededRng(1))!.id).toBe(2);
    expect(pickMailbox([c(1, 5, 30, t1), c(2, 5, 30, null)], seededRng(1))!.id).toBe(2);
  });

  it('full ties resolve via the seeded rng — deterministic', () => {
    const cands = [c(1, 0, 30), c(2, 0, 30), c(3, 0, 30)];
    const a = pickMailbox(cands, seededRng(5))!.id;
    const b = pickMailbox(cands, seededRng(5))!.id;
    expect(a).toBe(b);
  });

  it('ignores exhausted budgets; null when nothing is eligible', () => {
    expect(pickMailbox([c(1, 30, 30), c(2, 12, 30)], seededRng(1))!.id).toBe(2);
    expect(pickMailbox([c(1, 30, 30)], seededRng(1))).toBeNull();
    expect(pickMailbox([], seededRng(1))).toBeNull();
  });

  it('different caps compare by ratio, not absolute sends', () => {
    // mb1: 10/40 = 0.25; mb2: 5/10 = 0.5 → mb1 despite more sends
    expect(pickMailbox([c(1, 10, 40), c(2, 5, 10)], seededRng(1))!.id).toBe(1);
  });
});
