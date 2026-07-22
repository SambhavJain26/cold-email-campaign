// THE transactional chokepoint (docs/02 §3, docs/04 §3): the only way facts
// enter the system. Appends event(s) and updates the affected projections in
// ONE Postgres transaction. Nothing else writes `events` or
// `enrollments.current_state`.
import type { Db, Tx } from '../db/client';
import { insertEvents, listByEnrollments } from '../db/repos/eventsRepo';
import { writeProjection, listIdsByState, patchScheduling } from '../db/repos/enrollmentsRepo';
import { suppressLead } from '../db/repos/suppressionsRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { acquireRebuildLockShared, lockEnrollment } from '../db/repos/locksRepo';
import type { DomainEvent } from '../domain/events';
import {
  completeSnapshot,
  foldEvents,
  shouldComplete,
  type SequenceShape,
} from '../domain/reducer';

/**
 * Scheduling columns the reducer cannot derive (they need the sequence
 * definition / wall time): set atomically with the append (docs/02 §3).
 * nextSendAt is ignored when the fold lands on a terminal state — the
 * projection writer clears it and nothing may resurrect a dead enrollment.
 */
export interface SchedulingPatch {
  enrollmentId: number;
  nextSendAt?: Date | null;
  assignedMailboxId?: number;
}

export interface AppendOptions {
  patches?: readonly SchedulingPatch[];
  /** Extra same-transaction work (sent_messages row, incoming_messages row, …). */
  txWork?: (tx: Tx, eventIds: number[]) => Promise<void>;
}

export class EventStore {
  constructor(private readonly db: Db) {}

  /**
   * Append events and update projections atomically. Events may span multiple
   * enrollments (batch import); each affected enrollment's projection is
   * recomputed by folding its FULL event history — projection == fold(log)
   * by construction, which is what makes rebuild a no-op check.
   */
  async append(evs: readonly DomainEvent[], opts: AppendOptions = {}): Promise<number[]> {
    if (evs.length === 0) return [];
    return this.db.transaction(async (tx) => {
      // Rebuild takes this exclusively; appends share it.
      await acquireRebuildLockShared(tx);

      const settings = await getSettings(tx);
      const shape: SequenceShape = {
        lastStepNo: Number.POSITIVE_INFINITY, // completion is a separate derived step
        softRetryMax: settings.softRetryMax,
      };

      const ids = await insertEvents(tx, evs);

      const enrollmentIds = [
        ...new Set(
          evs
            .map((e) => ('enrollmentId' in e ? e.enrollmentId : undefined))
            .filter((v): v is number => v !== undefined),
        ),
      ].sort((a, b) => a - b); // stable order avoids deadlocks between concurrent appends
      for (const eid of enrollmentIds) {
        await lockEnrollment(tx, eid);
      }

      const byEnrollment = await listByEnrollments(tx, enrollmentIds);
      const terminalIds = new Set<number>();
      for (const eid of enrollmentIds) {
        const snapshot = foldEvents(byEnrollment.get(eid) ?? [], shape);
        await writeProjection(tx, eid, snapshot);
        if (snapshot.state !== 'NEW' && snapshot.state !== 'ACTIVE') terminalIds.add(eid);
      }

      // Scheduling patches (docs/02 §3): same tx, after the fold so a
      // terminal outcome always wins over a stale nextSendAt.
      for (const p of opts.patches ?? []) {
        const patch = terminalIds.has(p.enrollmentId) ? { ...p, nextSendAt: undefined } : p;
        await patchScheduling(tx, p.enrollmentId, patch);
      }

      // Suppression side effects (docs/04 §3) — same transaction, so an
      // unsubscribe can never land without its suppression row.
      for (const e of evs) {
        if (e.type === 'hard_bounce') {
          await suppressLead(tx, e.leadId, 'hard_bounce', e.occurredAt);
        } else if (e.type === 'unsubscribe' && settings.suppressUnsubs) {
          await suppressLead(tx, e.leadId, 'unsubscribed', e.occurredAt);
        }
      }

      if (opts.txWork) await opts.txWork(tx, ids);

      return ids;
    });
  }

  /**
   * The derived COMPLETED transition (docs/04 §2.1): ACTIVE enrollments that
   * have sent every step and outlived the delivery-confirm window become
   * COMPLETED. No event is appended — completion is derivable from the log.
   * Called by the scheduler tick (B3) and tests. Returns count completed.
   */
  async completeEligible(
    shape: SequenceShape,
    deliveryConfirmMs: number,
    now: Date,
    campaignId: number | null = null,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      await acquireRebuildLockShared(tx);
      const activeIds = await listIdsByState(tx, campaignId, 'ACTIVE');
      const byEnrollment = await listByEnrollments(tx, activeIds);
      let completed = 0;
      for (const eid of activeIds) {
        const evs = byEnrollment.get(eid) ?? [];
        const snapshot = foldEvents(evs, shape);
        const lastSentAt = evs.filter((e) => e.type === 'sent').at(-1)?.occurredAt ?? null;
        if (shouldComplete(snapshot, shape, lastSentAt, now, deliveryConfirmMs)) {
          const completedAt = new Date(lastSentAt!.getTime() + deliveryConfirmMs);
          await writeProjection(tx, eid, completeSnapshot(snapshot, completedAt));
          completed += 1;
        }
      }
      return completed;
    });
  }
}
