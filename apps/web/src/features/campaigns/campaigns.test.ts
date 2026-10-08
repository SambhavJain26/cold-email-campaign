// F5 — the Stage-9 outcomes reconciliation the completion panel is built on.
import { describe, expect, it } from 'vitest';
import type { OutcomesResponse } from '@coldemail/shared';
import { outcomeRows, outcomesSum } from './completion-panel';

const golden: OutcomesResponse = {
  STOPPED: 0,
  UNSUBSCRIBED: 40,
  BOUNCED: 18,
  REPLIED: { positive: 28, neutral: 19 },
  COMPLETED: 780,
  ACTIVE: 0,
  NEW: 0,
  total: 885,
};

describe('outcomes reconciliation', () => {
  it('sums the mutually-exclusive terminal states to the enrolled total', () => {
    expect(outcomesSum(golden)).toBe(golden.total); // 28+19+40+18+780 = 885
  });

  it('lists every terminal bucket exactly once', () => {
    expect(outcomeRows(golden).map(([label]) => label)).toEqual([
      'Replied — positive',
      'Replied — neutral/negative',
      'Unsubscribed',
      'Hard bounced',
      'Completed (no reply)',
      'Stopped',
      'Suppressed address',
    ]);
  });

  it('surfaces a mismatch instead of hiding it', () => {
    expect(outcomesSum({ ...golden, COMPLETED: 779 })).not.toBe(golden.total);
  });
});
