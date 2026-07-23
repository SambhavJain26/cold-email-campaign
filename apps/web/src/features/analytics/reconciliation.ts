// F7 — the reconciliation footers (docs/12 §8). Every analytics table restates
// its own totals and compares them to the campaign-level number from the SAME
// log. A ✗ here means a real drift, so the check is computed, never assumed.
import type { StepAnalyticsRow, TierAnalyticsRow, VariantAnalyticsRow } from '@coldemail/shared';

export interface Reconciliation {
  label: string;
  sum: number;
  /** The campaign-level figure to match, when the screen has it loaded. */
  expected: number | null;
  ok: boolean;
}

function check(label: string, sum: number, expected: number | null): Reconciliation {
  return { label, sum, expected, ok: expected === null || sum === expected };
}

export function stepsReconciliation(
  rows: StepAnalyticsRow[],
  campaignPositives: number | null,
): Reconciliation {
  const sum = rows.reduce((total, row) => total + row.positive_replies, 0);
  return check('positives', sum, campaignPositives);
}

export function tiersReconciliation(
  rows: TierAnalyticsRow[],
  campaignMeetings: number | null,
  campaignContacted: number | null,
): Reconciliation[] {
  return [
    check(
      'meetings',
      rows.reduce((total, row) => total + row.meetings, 0),
      campaignMeetings,
    ),
    check(
      'contacted',
      rows.reduce((total, row) => total + row.contacted, 0),
      campaignContacted,
    ),
  ];
}

export function variantsMeetings(rows: VariantAnalyticsRow[]): number {
  return rows.reduce((total, row) => total + row.meetings, 0);
}

/** 13a's winner: most meetings, ties broken on positive rate (docs/12 §8). */
export function winningVariant(rows: VariantAnalyticsRow[]): VariantAnalyticsRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => {
    if (row.meetings !== best.meetings) return row.meetings > best.meetings ? row : best;
    return row.positive_rate.value > best.positive_rate.value ? row : best;
  });
}

export type StepVerdict = 'weak' | 'strong' | 'keep' | 'small_sample';

/** WEAK = positive rate under 0.5% with enough delivered volume to trust it. */
export function stepVerdict(row: StepAnalyticsRow, bestRate: number): StepVerdict {
  if (row.delivered < 200) return 'small_sample';
  if (row.positive_rate.value < 0.5) return 'weak';
  return row.positive_rate.value === bestRate ? 'strong' : 'keep';
}
