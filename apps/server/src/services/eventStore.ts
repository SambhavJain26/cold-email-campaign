// THE transactional chokepoint (docs/02 §3, docs/04 §3): the only way facts
// enter the system. Appends event(s) and updates the affected projections in
// ONE Postgres transaction. Nothing else writes `events` or
// `enrollments.current_state`.
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { insertEvents, listByEnrollments } from '../db/repos/eventsRepo';
import { writeProjection, listIdsByState } from '../db/repos/enrollmentsRepo';
import { suppressLead } from '../db/repos/suppressionsRepo';
import { getSettings } from '../db/repos/settingsRepo';
import type { DomainEvent } from '../domain/events';
import {
  completeSnapshot,
  foldEvents,
  shouldComplete,
  type SequenceShape,
} from '../domain/reducer';

/** Shared advisory-lock keyspace: (0,0) = projection-wide (rebuild holds it exclusively). */
const REBUILD_LOCK = [0, 0] as const;

export class EventStore {
  constructor(private readonly db: Db) {}

  /**
   * Append events and update projections atomically. Events may span multiple
   * enrollments (batch import); each affected enrollment's projection is
   * recomputed by folding its FULL event history - projection == fold(log)
   * by construction, which is what makes rebuild a no-op check.
   */
  async append(evs: readonly DomainEvent[]): Promise<number[]> {
    if (evs.length === 0) return [];
    return this.db.transaction(async (tx) => {
      // Rebuild takes this exclusively; appends share it.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock_shared(${REBUILD_LOCK[0]}, ${REBUILD_LOCK[1]})`,
      );

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
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1, ${eid})`);
      }

      const byEnrollment = await listByEnrollments(tx, enrollmentIds);
      for (const eid of enrollmentIds) {
        const snapshot = foldEvents(byEnrollment.get(eid) ?? [], shape);
        await writeProjection(tx, eid, snapshot);
      }

      // Suppression side effects (docs/04 §3) - same transaction, so an
      // unsubscribe can never land without its suppression row.
      for (const e of evs) {
        if (e.type === 'hard_bounce') {
          await suppressLead(tx, e.leadId, 'hard_bounce', e.occurredAt);
        } else if (e.type === 'unsubscribe' && settings.suppressUnsubs) {
          await suppressLead(tx, e.leadId, 'unsubscribed', e.occurredAt);
        }
      }

      return ids;
    });
  }

  /**
   * The derived COMPLETED transition (docs/04 §2.1): ACTIVE enrollments that
   * have sent every step and outlived the delivery-confirm window become
   * COMPLETED. No event is appended - completion is derivable from the log.
   * Called by the scheduler tick (B3) and tests. Returns count completed.
   */
  async completeEligible(
    shape: SequenceShape,
    deliveryConfirmMs: number,
    now: Date,
    campaignId: number | null = null,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock_shared(${REBUILD_LOCK[0]}, ${REBUILD_LOCK[1]})`,
      );
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
