// F7 - the analytics arithmetic the tables display: reconciliation footers,
// the 13a winner rule, 13b verdicts, and the 13d rate rows.
import { describe, expect, it } from 'vitest';
import type { StepAnalyticsRow, TierAnalyticsRow, VariantAnalyticsRow } from '@coldemail/shared';
import { buildHealthRows } from './health-tab';
import {
  stepVerdict,
  stepsReconciliation,
  tiersReconciliation,
  variantsMeetings,
  winningVariant,
} from './reconciliation';

const steps: StepAnalyticsRow[] = [
  { step_no: 1, delivered: 867, positive_replies: 15, positive_rate: m(15, 867, 1.7) },
  { step_no: 2, delivered: 831, positive_replies: 9, positive_rate: m(9, 831, 1.1) },
  { step_no: 3, delivered: 801, positive_replies: 1, positive_rate: m(1, 801, 0.1) },
  { step_no: 4, delivered: 789, positive_replies: 3, positive_rate: m(3, 789, 0.4) },
];

const tiers: TierAnalyticsRow[] = [
  {
    tier: 'A',
    contacted: 255,
    reply_rate: m(33, 255, 12.9),
    positive_rate: m(17, 255, 6.7),
    meetings: 13,
    mode: 'human_written',
  },
  {
    tier: 'B',
    contacted: 447,
    reply_rate: m(31, 447, 6.9),
    positive_rate: m(8, 447, 1.8),
    meetings: 3,
    mode: 'template_researched',
  },
  {
    tier: 'C',
    contacted: 165,
    reply_rate: m(8, 165, 4.8),
    positive_rate: m(3, 165, 1.8),
    meetings: 1,
    mode: 'template_auto',
  },
];

function m(numerator: number, denominator: number, value: number) {
  return { numerator, denominator, value };
}

describe('reconciliation footers', () => {
  it('sums step positives and matches the campaign total (golden: 28)', () => {
    expect(stepsReconciliation(steps, 28)).toEqual({
      label: 'positives',
      sum: 28,
      expected: 28,
      ok: true,
    });
  });

  it('flags a drift instead of hiding it', () => {
    expect(stepsReconciliation(steps, 27).ok).toBe(false);
  });

  it('passes when the campaign figure has not loaded (nothing to compare)', () => {
    expect(stepsReconciliation(steps, null).ok).toBe(true);
  });

  it('sums tier meetings and contacted (golden: 17 and 867)', () => {
    expect(tiersReconciliation(tiers, 17, 867).map((c) => [c.label, c.sum, c.ok])).toEqual([
      ['meetings', 17, true],
      ['contacted', 867, true],
    ]);
  });
});

describe('13a winner', () => {
  const variant = (label: string, meetings: number, positive: number): VariantAnalyticsRow => ({
    variant_id: label.charCodeAt(0),
    label,
    subject_template: 's',
    sent: 200,
    reply_rate: m(10, 200, 5),
    positive_rate: m(positive, 200, positive),
    meetings,
  });

  it('ranks on meetings, not reply rate', () => {
    expect(winningVariant([variant('A', 3, 4), variant('B', 8, 2)])?.label).toBe('B');
  });

  it('breaks ties on positive rate', () => {
    expect(winningVariant([variant('A', 5, 2), variant('B', 5, 4)])?.label).toBe('B');
  });

  it('sums meetings across variants', () => {
    expect(variantsMeetings([variant('A', 3, 4), variant('B', 8, 2)])).toBe(11);
  });
});

describe('13b verdicts', () => {
  it('marks a sub-0.5% step WEAK once the volume is trustworthy', () => {
    expect(stepVerdict(steps[2]!, 1.7)).toBe('weak');
  });

  it('marks the best rate strong and the rest keep', () => {
    expect(stepVerdict(steps[0]!, 1.7)).toBe('strong');
    expect(stepVerdict(steps[1]!, 1.7)).toBe('keep');
  });

  it('withholds a verdict under 200 delivered', () => {
    expect(stepVerdict({ ...steps[2]!, delivered: 150 }, 1.7)).toBe('small_sample');
  });
});

describe('13d health rows', () => {
  const items = [
    { day: '1', sent: 100, delivered: 95, replies: 5, hard_bounces: 5, unsubscribes: 1 },
    { day: '2', sent: 100, delivered: 95, replies: 5, hard_bounces: 1, unsubscribes: 1 },
  ];
  const totals = { sent: 200, delivered: 190, replies: 10, hard_bounces: 6, unsubscribes: 2 };

  it('computes each rate against its own denominator', () => {
    const rows = buildHealthRows(items, totals);
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
    expect(byLabel['Reply rate']!.value).toBe('5.3%'); // 10 / 190 delivered
    expect(byLabel['Hard-bounce rate']!.value).toBe('3%'); // 6 / 200 sent
    expect(byLabel['Unsubscribe rate']!.detail).toContain('2 / 190 delivered');
  });

  it('flags a rate over its threshold', () => {
    const rows = buildHealthRows(items, { ...totals, hard_bounces: 20 }); // 10%
    expect(rows.find((row) => row.label === 'Hard-bounce rate')!.status).toBe('⚠️');
  });
});
