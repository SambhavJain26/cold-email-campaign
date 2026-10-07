// New mailboxes persist a randomly selected next-send deadline. The older
// window/cap and fixed-interval helpers remain for rollback/legacy configuration.
import type { SendWindow } from '../db/schema/transport';
import type { Rng } from '../util/rng';
import { windowMinutes } from './window';

/** minGap in ms — 540 min / 30 = 18 min for the default window+cap. */
export function minGapMs(window: SendWindow, capToday: number): number {
  if (capToday <= 0) return Number.POSITIVE_INFINITY;
  return (windowMinutes(window) * 60_000) / capToday;
}

/** Multiplicative jitter factor in [1 - pct/100, 1 + pct/100]. */
export function jitterFactor(rng: Rng, jitterPct: number): number {
  return 1 + (rng() * 2 - 1) * (jitterPct / 100);
}

/** Has the mailbox's pace gap elapsed since its last send? */
export function paceReady(now: Date, lastSendAt: Date | null, gapMs: number): boolean {
  if (lastSendAt === null) return true;
  return now.getTime() - lastSendAt.getTime() >= gapMs;
}

/** Uniform inclusive integer seconds, drawn once per accepted send or range edit. */
export function nextAllowedSendAt(
  lastSendAt: Date,
  minMinutes: number,
  maxMinutes: number,
  rng: Rng,
): Date {
  const seconds = minMinutes * 60 + Math.floor(rng() * ((maxMinutes - minMinutes) * 60 + 1));
  return new Date(lastSendAt.getTime() + seconds * 1000);
}
