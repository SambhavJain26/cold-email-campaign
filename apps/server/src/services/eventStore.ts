// THE transactional chokepoint (docs/02 §3, docs/04 §3): the only way facts
// enter the system. Appends event(s) and updates the affected projections in
// ONE Postgres transaction. Nothing else writes `events` or
// `enrollments.current_state`.
import type { Db, DbLike, Tx } from '../db/client';
import { liveStopTargets } from '../db/repos/incomingStopsRepo';
import { insertEvents, listByEnrollments } from '../db/repos/eventsRepo';
import {
  writeProjection,
  listIdsActivePastStep,
  patchScheduling,
  getById,
} from '../db/repos/enrollmentsRepo';
import { suppressLead } from '../db/repos/suppressionsRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { loadSequenceDef } from '../db/repos/sequencesRepo';
import { getCampaign } from '../db/repos/campaignsRepo';
import { acquireRebuildLockShared, lockEnrollment, lockLead } from '../db/repos/locksRepo';
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
   * The event ledger is shared by scheduler, poller, and manual actions, so
   * the reducer must load the sequence's reply policy here rather than relying
   * on a caller-specific scheduler shape.  Legacy/no-sequence campaigns retain
   * the historically safe "stop on reply" default.
   */
  private async shapeForCampaign(
    db: DbLike,
    campaignId: number,
    softRetryMax: number,
  ): Promise<SequenceShape> {
    const campaign = await getCampaign(db, campaignId);
    const sequence = campaign?.sequenceId ? await loadSequenceDef(db, campaign.sequenceId) : null;
    return {
      lastStepNo: Number.POSITIVE_INFINITY,
      softRetryMax,
      stopOnReply: sequence?.stopOnReply ?? true,
    };
  }

  /**
   * Serialize a scheduler send decision with any inbound event append for the
   * same enrollment.  Cron offsets reduce contention; this lock is the actual
   * correctness guarantee.
   */
  async withEnrollmentLock<T>(enrollmentId: number, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await acquireRebuildLockShared(tx);
      const enrollment = await getById(tx, enrollmentId);
      if (!enrollment) throw new Error(`enrollment ${enrollmentId} not found`);
      await lockLead(tx, enrollment.leadId);
      await lockEnrollment(tx, enrollmentId);
      return work(tx);
    });
  }

  /**
   * Append events and update projections atomically. Events may span multiple
   * enrollments (batch import); each affected enrollment's projection is
   * recomputed by folding its FULL event history — projection == fold(log)
   * by construction, which is what makes rebuild a no-op check.
   */
  async append(evs: readonly DomainEvent[], opts: AppendOptions = {}): Promise<number[]> {
    if (evs.length === 0) return [];
    return this.db.transaction((tx) => this.appendInTransaction(tx, evs, opts));
  }

  /**
   * Caller-owned transaction variant for workflows that must create an
   * enrollment and its first ledger fact atomically. The caller must not do
   * any externally visible work inside that transaction.
   */
  async appendInTransaction(
    tx: Tx,
    evs: readonly DomainEvent[],
    opts: AppendOptions = {},
  ): Promise<number[]> {
    if (evs.length === 0) return [];
    // Rebuild takes this exclusively; appends share it.
    await acquireRebuildLockShared(tx);

    for (const leadId of [...new Set(evs.map((event) => event.leadId))].sort((a, b) => a - b)) {
      await lockLead(tx, leadId);
    }

    const settings = await getSettings(tx);
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

    // Serialize BEFORE inserting facts. Poller and scheduler therefore cannot
    // both observe an enrollment as active and append contradictory outcomes.
    // Revalidate policy stops after locking; concurrent incoming messages may
    // have already stopped/completed the enrollment while classification ran.
    const liveIds = evs.some((event) => event.type === 'outreach_stopped')
      ? await liveStopTargets(tx, enrollmentIds)
      : new Set<number>();
    const effective = evs.filter(
      (event) => event.type !== 'outreach_stopped' || liveIds.has(event.enrollmentId),
    );
    const ids = await insertEvents(tx, effective);

    const byEnrollment = await listByEnrollments(tx, enrollmentIds);
    const terminalIds = new Set<number>();
    for (const eid of enrollmentIds) {
      const history = byEnrollment.get(eid) ?? [];
      const campaignId = history[0]?.campaignId;
      if (campaignId === undefined) throw new Error(`enrollment ${eid} has no campaign history`);
      const snapshot = foldEvents(
        history,
        await this.shapeForCampaign(tx, campaignId, settings.softRetryMax),
      );
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
      } else if (e.type === 'unsubscribe' || e.type === 'address_suppressed') {
        await suppressLead(tx, e.leadId, 'unsubscribed', e.occurredAt);
      }
    }

    if (opts.txWork) await opts.txWork(tx, ids);

    return ids;
  }

  /**
   * Append for the enrollment currently protected by `withEnrollmentLock`.
   * It deliberately does not reacquire its advisory lock, which is already
   * held by the caller for the lifetime of the SMTP decision.
   */
  async appendUnderEnrollmentLock(
    tx: Tx,
    enrollmentId: number,
    evs: readonly DomainEvent[],
    opts: AppendOptions = {},
  ): Promise<number[]> {
    if (evs.length === 0) return [];
    const enrollmentIds = [
      ...new Set(
        evs
          .map((e) => ('enrollmentId' in e ? e.enrollmentId : undefined))
          .filter((v): v is number => v !== undefined),
      ),
    ];
    if (enrollmentIds.length !== 1 || enrollmentIds[0] !== enrollmentId) {
      throw new Error('appendUnderEnrollmentLock may only append its locked enrollment');
    }
    const settings = await getSettings(tx);
    const ids = await insertEvents(tx, evs);
    const history = (await listByEnrollments(tx, enrollmentIds)).get(enrollmentId) ?? [];
    const campaignId = history[0]?.campaignId;
    if (campaignId === undefined)
      throw new Error(`enrollment ${enrollmentId} has no campaign history`);
    const snapshot = foldEvents(
      history,
      await this.shapeForCampaign(tx, campaignId, settings.softRetryMax),
    );
    await writeProjection(tx, enrollmentId, snapshot);
    const terminal = snapshot.state !== 'NEW' && snapshot.state !== 'ACTIVE';
    for (const p of opts.patches ?? []) {
      await patchScheduling(tx, p.enrollmentId, terminal ? { ...p, nextSendAt: undefined } : p);
    }
    for (const e of evs) {
      if (e.type === 'hard_bounce') {
        await suppressLead(tx, e.leadId, 'hard_bounce', e.occurredAt);
      } else if (e.type === 'unsubscribe' || e.type === 'address_suppressed') {
        await suppressLead(tx, e.leadId, 'unsubscribed', e.occurredAt);
      }
    }
    if (opts.txWork) await opts.txWork(tx, ids);
    return ids;
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
      // Only enrollments already past the last step can complete — exact
      // SQL prefilter, keeps the per-tick sweep cheap.
      const activeIds = await listIdsActivePastStep(tx, campaignId, shape.lastStepNo);
      const activeRows = await Promise.all(activeIds.map((id) => getById(tx, id)));
      for (const leadId of [
        ...new Set(activeRows.flatMap((row) => (row ? [row.leadId] : []))),
      ].sort((a, b) => a - b)) {
        await lockLead(tx, leadId);
      }
      for (const id of [...activeIds].sort((a, b) => a - b)) await lockEnrollment(tx, id);
      let completed = 0;
      for (const eid of activeIds) {
        const byEnrollment = await listByEnrollments(tx, [eid]);
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
