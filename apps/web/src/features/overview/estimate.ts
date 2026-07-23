// F5.4 - the Overview's est-completion (docs/12 §1). Pure so the arithmetic is
// testable and can be shown to the operator verbatim: no fabricated rate when
// there is nothing to divide by.
export interface DailyRow {
  delivered: number;
}

export interface CompletionEstimate {
  remaining: number;
  /** 7-day average deliveries/day - the pace the estimate divides by. */
  perDay: number;
  days: number;
}

/** Uses the LAST 7 rows of the series (the API window may be longer than 7 days).
 *  Returns null when the estimate would be invented: nothing left, or no pace. */
export function estimateCompletion(
  contacted: number,
  total: number | null,
  series: DailyRow[],
): CompletionEstimate | null {
  if (total === null) return null;
  const remaining = total - contacted;
  if (remaining <= 0) return null;
  const window = series.slice(-7);
  if (window.length === 0) return null;
  const perDay = window.reduce((sum, row) => sum + row.delivered, 0) / window.length;
  if (perDay <= 0) return null;
  return { remaining, perDay: Math.round(perDay * 10) / 10, days: Math.ceil(remaining / perDay) };
}
