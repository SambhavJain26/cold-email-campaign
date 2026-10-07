import { describe, expect, it } from 'vitest';
import { nextAllowedSendAt } from '../../src/scheduler/pacing';
import { seededRng } from '../../src/util/rng';

describe('uniform persisted send gaps', () => {
  const anchor = new Date('2026-10-07T13:00:00Z');
  it('includes both second boundaries and produces varied whole-second gaps', () => {
    expect(nextAllowedSendAt(anchor, 4, 7, () => 0).getTime() - anchor.getTime()).toBe(240_000);
    expect(
      nextAllowedSendAt(anchor, 4, 7, () => 1 - Number.EPSILON).getTime() - anchor.getTime(),
    ).toBe(420_000);
    const rng = seededRng(91);
    const gaps = Array.from(
      { length: 1000 },
      () => (nextAllowedSendAt(anchor, 4, 7, rng).getTime() - anchor.getTime()) / 1000,
    );
    expect(gaps.every((gap) => Number.isInteger(gap) && gap >= 240 && gap <= 420)).toBe(true);
    expect(new Set(gaps).size).toBeGreaterThan(170);
  });
});
