// Per-mailbox display stats for GET /mailboxes (docs/10 Mailbox shape):
// sent_today (local-midnight convention, same as capacityToday), the
// auto-pause pct-window bounce rate, and the 7-day send average.
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import { getSettings } from '../db/repos/settingsRepo';
import type { MailboxRow } from '../db/repos/mailboxesRepo';
import { countSentSince, hardBouncesInLastNSends, lifetimeSentCount } from '../db/repos/eventsRepo';
import { mailboxVolume } from '../db/repos/metricsRepo';
import { mailboxImbalance } from './metrics/watchRules';
import { startOfLocalDay } from '../scheduler/window';

export interface MailboxStats {
  sentToday: number;
  hardBouncePct: number;
  sevenDayAvg: number;
}

export async function mailboxStatsFor(
  deps: { db: Db; clock: Clock },
  rows: MailboxRow[],
): Promise<Map<number, MailboxStats>> {
  const { db, clock } = deps;
  const now = clock.now();
  const settings = await getSettings(db);
  const midnight = startOfLocalDay(now, settings.defaultTimezone);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const { sevenDayAvg } = mailboxImbalance(await mailboxVolume(db, sevenDaysAgo, now));

  const stats = new Map<number, MailboxStats>();
  for (const mb of rows) {
    const sentToday = await countSentSince(db, mb.id, midnight);
    const lifetime = await lifetimeSentCount(db, mb.id);
    const windowBounces = await hardBouncesInLastNSends(db, mb.id, settings.pauseWindowSends);
    const denom = Math.min(lifetime, settings.pauseWindowSends);
    const hardBouncePct = denom === 0 ? 0 : Number(((windowBounces / denom) * 100).toFixed(1));
    stats.set(mb.id, { sentToday, hardBouncePct, sevenDayAvg: sevenDayAvg[mb.id] ?? 0 });
  }
  return stats;
}
