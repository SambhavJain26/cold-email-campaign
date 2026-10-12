import type { WaitDayMode } from '@coldemail/shared';
import { localParts, startOfLocalDay } from './window';

/** Eligibility, not a promised send instant. Business waits start at local midnight. */
export function followupDueAt(
  sentAt: Date,
  waitDays: number,
  mode: WaitDayMode,
  timezone: string,
): Date {
  if (!Number.isInteger(waitDays) || waitDays < 0) throw new Error('Invalid follow-up interval');
  if (mode === 'elapsed_days' || waitDays === 0)
    return new Date(sentAt.getTime() + waitDays * 86_400_000);
  // Intl local parts have second precision; remove the source milliseconds so
  // the existing midnight converter cannot carry them into target midnight.
  let day = startOfLocalDay(new Date(Math.floor(sentAt.getTime() / 1000) * 1000), timezone);
  let remaining = waitDays;
  while (remaining > 0) {
    // Noon of tomorrow remains tomorrow across 23/25-hour DST days.
    day = startOfLocalDay(new Date(day.getTime() + 36 * 3_600_000), timezone);
    if (localParts(day, timezone).isoWeekday <= 5) remaining -= 1;
  }
  return day;
}
