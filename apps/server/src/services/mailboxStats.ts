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

function localDateKey(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function previousCalendarDays(now: Date, timezone: string, count: number): string[] {
  const [year, month, day] = localDateKey(now, timezone).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day - (count - 1 - index))).toISOString().slice(0, 10),
  );
}

export async function mailboxStatsFor(
  deps: { db: Db; clock: Clock },
  rows: MailboxRow[],
): Promise<Map<number, MailboxStats>> {
  const { db, clock } = deps;
  const now = clock.now();
  const settings = await getSettings(db);
  const sevenDaysAgo = new Date(now.getTime() - 8 * 86_400_000);
  const rawVolume = await mailboxVolume(db, sevenDaysAgo, now);
  const sentByMailboxDay = new Map(
    rawVolume.map((row) => [`${row.mailbox_id}:${row.day}`, row.sends]),
  );
  const sevenDayRows = rows.flatMap((mailbox) =>
    previousCalendarDays(now, mailbox.timezone || settings.defaultTimezone, 7).map((day) => ({
      mailbox_id: mailbox.id,
      day,
      sends: sentByMailboxDay.get(`${mailbox.id}:${day}`) ?? 0,
    })),
  );
  const { sevenDayAvg } = mailboxImbalance(sevenDayRows);

  const stats = new Map<number, MailboxStats>();
  for (const mb of rows) {
    const sentToday = await countSentSince(
      db,
      mb.id,
      startOfLocalDay(now, mb.timezone || settings.defaultTimezone),
    );
    const lifetime = await lifetimeSentCount(db, mb.id);
    const windowBounces = await hardBouncesInLastNSends(db, mb.id, settings.pauseWindowSends);
    const denom = Math.min(lifetime, settings.pauseWindowSends);
    const hardBouncePct = denom === 0 ? 0 : Number(((windowBounces / denom) * 100).toFixed(1));
    stats.set(mb.id, { sentToday, hardBouncePct, sevenDayAvg: sevenDayAvg[mb.id] ?? 0 });
  }
  return stats;
}
