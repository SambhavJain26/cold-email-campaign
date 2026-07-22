// Health-trend watch rules (walkthrough 13d) — pure functions over the daily
// series so they are unit-testable without a DB. Both are early warnings, not
// pauses: they surface as alerts/banners only.
import type { DailySeriesRow, MailboxVolumeRow } from '../../db/repos/metricsRepo';

export interface WatchFlag {
  rule: 'reply_rate_drop' | 'unsub_rate_climbing' | 'mailbox_imbalance';
  message: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Reply rate ↓30% over the window: compare reply-per-delivered in the first
 * half vs the second half. Needs meaningful volume in both halves
 * (≥50 delivered each) to avoid small-sample noise.
 */
export function replyRateDrop(series: DailySeriesRow[]): WatchFlag | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const [a, b] = [series.slice(0, mid), series.slice(mid)];
  const [da, db_] = [sum(a.map((r) => r.delivered)), sum(b.map((r) => r.delivered))];
  if (da < 50 || db_ < 50) return null;
  const [ra, rb] = [sum(a.map((r) => r.replies)) / da, sum(b.map((r) => r.replies)) / db_];
  if (ra > 0 && rb < ra * 0.7) {
    return {
      rule: 'reply_rate_drop',
      message: `Reply rate dropped ${Math.round((1 - rb / ra) * 100)}% across the window — message fatiguing or list quality dropping.`,
    };
  }
  return null;
}

/**
 * Unsub rate climbing (leading indicator): positive linear-regression slope
 * of daily unsubscribes over the last 14 days, with ≥5 total (noise floor).
 */
export function unsubClimbing(series: DailySeriesRow[]): WatchFlag | null {
  const window = series.slice(-14);
  if (window.length < 7) return null;
  const ys = window.map((r) => r.unsubscribes);
  if (sum(ys) < 5) return null;
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = sum(ys) / n;
  let cov = 0;
  let varX = 0;
  ys.forEach((y, x) => {
    cov += (x - xMean) * (y - yMean);
    varX += (x - xMean) ** 2;
  });
  const slope = cov / varX;
  if (slope > 0.05) {
    return {
      rule: 'unsub_rate_climbing',
      message:
        'Unsubscribe rate is climbing — targeting or message is annoying people. This often rises before deliverability visibly drops.',
    };
  }
  return null;
}

/**
 * Rotation imbalance (walkthrough §11): a healthy mailbox's 7-day average
 * running >1.5× another's. Returns the flag plus per-mailbox averages.
 */
export function mailboxImbalance(volume: MailboxVolumeRow[]): {
  flag: WatchFlag | null;
  sevenDayAvg: Record<number, number>;
} {
  const byMailbox = new Map<number, number[]>();
  for (const r of volume) {
    (byMailbox.get(r.mailbox_id) ?? byMailbox.set(r.mailbox_id, []).get(r.mailbox_id)!).push(
      r.sends,
    );
  }
  const sevenDayAvg: Record<number, number> = {};
  for (const [id, sends] of byMailbox) {
    const last7 = sends.slice(-7);
    sevenDayAvg[id] = Math.round((sum(last7) / Math.max(last7.length, 1)) * 10) / 10;
  }
  const avgs = Object.values(sevenDayAvg).filter((v) => v > 0);
  if (avgs.length >= 2 && Math.max(...avgs) > 1.5 * Math.min(...avgs)) {
    return {
      flag: {
        rule: 'mailbox_imbalance',
        message:
          'Rotation imbalance: one mailbox is running >1.5x hotter than another — rebalance so no single inbox carries the load.',
      },
      sevenDayAvg,
    };
  }
  return { flag: null, sevenDayAvg };
}
