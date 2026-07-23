// F5.4 - the Overview's completion estimate: honest arithmetic or nothing.
import { describe, expect, it } from 'vitest';
import { estimateCompletion } from './estimate';

describe('estimateCompletion', () => {
  it('divides what is left by the last-7-day delivery pace', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ delivered: i < 3 ? 100 : 10 }));
    // Only the last 7 rows count - all 10/day; 35 remaining → 4 days.
    expect(estimateCompletion(50, 85, series)).toEqual({ remaining: 35, perDay: 10, days: 4 });
  });

  it('never invents a number: no total, nothing remaining, or no pace', () => {
    const series = [{ delivered: 10 }];
    expect(estimateCompletion(50, null, series)).toBeNull();
    expect(estimateCompletion(85, 85, series)).toBeNull();
    expect(estimateCompletion(50, 85, [{ delivered: 0 }])).toBeNull();
    expect(estimateCompletion(50, 85, [])).toBeNull();
  });
});
