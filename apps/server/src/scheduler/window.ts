// Send-window math (docs/06 §4): windows are the MAILBOX's configured hours
// evaluated in the RECIPIENT's zone. Daily caps reset at local midnight —
// implemented as "count sent events since local midnight", so there is no
// reset cron and no drift. All tz conversion via Intl (no deps).
import type { SendWindow } from '../db/schema/transport';

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday 1=Mon … 7=Sun. */
  isoWeekday: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    partsCache.set(tz, f);
  }
  return f;
}

export function localParts(now: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(now)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24; // Intl can yield '24' at midnight
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
  return { year, month, day, hour, minute, second, isoWeekday: ((jsDay + 6) % 7) + 1 };
}

export function parseHHMM(s: string): number {
  const [h, m] = s.split(':');
  return Number(h) * 60 + Number(m);
}

export function windowMinutes(w: SendWindow): number {
  return parseHHMM(w.end) - parseHHMM(w.start);
}

/** Is `now`, seen from `tz`, inside the window? (day ∈ days, start ≤ local < end) */
export function insideWindow(w: SendWindow, now: Date, tz: string): boolean {
  const p = localParts(now, tz);
  if (!w.days.includes(p.isoWeekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= parseHHMM(w.start) && minutes < parseHHMM(w.end);
}

/** Offset (ms) such that `now + offset` reads as local wall-clock in UTC fields. */
function tzOffsetMs(now: Date, tz: string): number {
  const p = localParts(now, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - now.getTime();
}

/** The UTC instant of the most recent local midnight in `tz` (cap-reset anchor). */
export function startOfLocalDay(now: Date, tz: string): Date {
  const offset = tzOffsetMs(now, tz);
  const local = new Date(now.getTime() + offset);
  const localMidnightAsUTC = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  // First guess assumes the offset at midnight equals the offset now; correct
  // once for DST transitions crossing midnight.
  let instant = localMidnightAsUTC - offset;
  instant = localMidnightAsUTC - tzOffsetMs(new Date(instant), tz);
  return new Date(instant);
}
