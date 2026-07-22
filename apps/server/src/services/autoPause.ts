// Auto-pause engine (B3.13, docs/06 §6, spec Part 11). Event-driven: runs
// post-commit on every hard_bounce append (scheduler's RCPT-5xx path and the
// poller's DSN path), not per-tick.
import type { Db } from '../db/client';
import type { AlertSink } from '../alerts/types';
import { getSettings } from '../db/repos/settingsRepo';
import { getMailbox, patchMailbox } from '../db/repos/mailboxesRepo';
import { hardBouncesInLastNSends, lifetimeSentCount } from '../db/repos/eventsRepo';

export interface AutoPauseDeps {
  db: Db;
  alerts: AlertSink;
}

export interface AutoPauseResult {
  paused: boolean;
  rule?: 'absolute' | 'pct';
  absoluteWindow: { bounces: number; span: number };
  pctWindow: { bounces: number; window: number; pct: number };
}

/**
 * Absolute rule: ≥ pause_absolute_bounces hard bounces in the last
 * pause_absolute_span sends (works at any volume). Pct rule: lifetime sends ≥
 * pause_min_sends and bounce rate over the last pause_window_sends >
 * pause_hard_pct. On pause: status auto_paused + alert with BOTH window
 * numbers (walkthrough Stage 7 panel).
 */
export async function evaluateAutoPause(
  deps: AutoPauseDeps,
  mailboxId: number,
  now: Date,
): Promise<AutoPauseResult> {
  const { db, alerts } = deps;
  const settings = await getSettings(db);
  const mb = await getMailbox(db, mailboxId);

  const sends = await lifetimeSentCount(db, mailboxId);
  const absoluteBounces = await hardBouncesInLastNSends(db, mailboxId, settings.pauseAbsoluteSpan);
  const pctBounces = await hardBouncesInLastNSends(db, mailboxId, settings.pauseWindowSends);
  const pctDenominator = Math.min(sends, settings.pauseWindowSends);
  const pct = pctDenominator === 0 ? 0 : (pctBounces / pctDenominator) * 100;

  const result: AutoPauseResult = {
    paused: false,
    absoluteWindow: { bounces: absoluteBounces, span: settings.pauseAbsoluteSpan },
    pctWindow: { bounces: pctBounces, window: settings.pauseWindowSends, pct },
  };

  if (!mb || mb.status !== 'ok') return result; // already paused/dead — nothing to do

  if (absoluteBounces >= settings.pauseAbsoluteBounces) {
    result.paused = true;
    result.rule = 'absolute';
  } else if (sends >= settings.pauseMinSends && pct > Number(settings.pauseHardPct)) {
    result.paused = true;
    result.rule = 'pct';
  }

  if (result.paused) {
    await patchMailbox(db, mailboxId, {
      status: 'auto_paused',
      statusReason: `auto-pause (${result.rule}): ${absoluteBounces}/${settings.pauseAbsoluteSpan} absolute, ${pctBounces}/${settings.pauseWindowSends} (${pct.toFixed(1)}%) window`,
      pausedAt: now,
    });
    await alerts.emit('mailbox_auto_paused', 'warning', {
      mailboxId,
      rule: result.rule,
      absoluteWindow: result.absoluteWindow,
      pctWindow: { ...result.pctWindow, pct: Number(pct.toFixed(1)) },
      lifetimeSends: sends,
    });
  }
  return result;
}

/**
 * Operator resume (docs/06 §6): back to ok at capPct% of daily cap.
 * resume_cap auto-clears after 7 consecutive clean days (tick housekeeping).
 */
export async function resumeMailbox(
  deps: Pick<AutoPauseDeps, 'db'>,
  mailboxId: number,
  capPct: number,
  now: Date,
): Promise<void> {
  const mb = await getMailbox(deps.db, mailboxId);
  if (!mb) throw new Error(`mailbox ${mailboxId} not found`);
  await patchMailbox(deps.db, mailboxId, {
    status: 'ok',
    statusReason: null,
    resumeCap: Math.max(1, Math.floor((mb.dailyCap * capPct) / 100)),
    pausedAt: now, // anchor for the 7-clean-days auto-clear
  });
}
