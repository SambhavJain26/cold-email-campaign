// rebuild-projections (docs/04 §5): replay the event log to reconstruct every
// enrollment projection. Disaster recovery and correctness audit in one —
// --dry-run diffs derived state against stored state without writing.
import type { Db } from '../db/client';
import { listByEnrollments } from '../db/repos/eventsRepo';
import { listAll, writeProjection } from '../db/repos/enrollmentsRepo';
import { suppressLead } from '../db/repos/suppressionsRepo';
import { acquireRebuildLockExclusive } from '../db/repos/locksRepo';
import {
  completeSnapshot,
  foldEvents,
  shouldComplete,
  type EnrollmentSnapshot,
  type SequenceShape,
} from '../domain/reducer';

export interface ProjectionDiff {
  enrollmentId: number;
  field: string;
  stored: unknown;
  derived: unknown;
}

export interface RebuildOptions {
  dryRun: boolean;
  campaignId?: number | null;
  /** Sequence shape per campaign. B4 wires the DB lookup; until then callers supply it. */
  shapeFor: (campaignId: number) => SequenceShape;
  deliveryConfirmMs: number;
  now: Date;
}

export interface RebuildResult {
  checked: number;
  diffs: ProjectionDiff[];
  written: number;
}

const ms = (d: Date | null) => (d === null ? null : d.getTime());

function diffSnapshot(
  enrollmentId: number,
  stored: {
    currentState: string;
    currentStepNo: number;
    softBounceRetries: number;
    bestReplySentiment: string | null;
    meetingBooked: boolean;
    terminalAt: Date | null;
  },
  derived: EnrollmentSnapshot,
): ProjectionDiff[] {
  const checks: [string, unknown, unknown][] = [
    ['current_state', stored.currentState, derived.state],
    ['current_step_no', stored.currentStepNo, derived.currentStepNo],
    ['soft_bounce_retries', stored.softBounceRetries, derived.softBounceRetries],
    ['best_reply_sentiment', stored.bestReplySentiment, derived.bestReplySentiment],
    ['meeting_booked', stored.meetingBooked, derived.meetingBooked],
    ['terminal_at', ms(stored.terminalAt), ms(derived.terminalAt)],
  ];
  return checks
    .filter(([, a, b]) => a !== b)
    .map(([field, a, b]) => ({ enrollmentId, field, stored: a, derived: b }));
}

export async function rebuildProjections(db: Db, opts: RebuildOptions): Promise<RebuildResult> {
  return db.transaction(async (tx) => {
    await acquireRebuildLockExclusive(tx); // blocks concurrent appends

    const rows = await listAll(tx, opts.campaignId ?? null);
    const byEnrollment = await listByEnrollments(
      tx,
      rows.map((r) => r.id),
    );

    const diffs: ProjectionDiff[] = [];
    let written = 0;

    for (const row of rows) {
      const evs = byEnrollment.get(row.id) ?? [];
      const shape = opts.shapeFor(row.campaignId);
      let derived = foldEvents(evs, shape);
      const lastSentAt = evs.filter((e) => e.type === 'sent').at(-1)?.occurredAt ?? null;
      if (shouldComplete(derived, shape, lastSentAt, opts.now, opts.deliveryConfirmMs)) {
        derived = completeSnapshot(
          derived,
          new Date(lastSentAt!.getTime() + opts.deliveryConfirmMs),
        );
      }

      const enrollmentDiffs = diffSnapshot(row.id, row, derived);
      diffs.push(...enrollmentDiffs);
      if (!opts.dryRun && enrollmentDiffs.length > 0) {
        await writeProjection(tx, row.id, derived);
        written += 1;
      }

      // Suppression integrity (invariant #5): terminal events imply suppression.
      if (!opts.dryRun) {
        for (const e of evs) {
          if (e.type === 'hard_bounce')
            await suppressLead(tx, e.leadId, 'hard_bounce', e.occurredAt);
          else if (e.type === 'unsubscribe')
            await suppressLead(tx, e.leadId, 'unsubscribed', e.occurredAt);
        }
      }
    }

    return { checked: rows.length, diffs, written };
  });
}
