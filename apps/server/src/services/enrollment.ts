// Capacity + enrollment (B3.9, docs/06 §7, walkthrough Stages 5/8).
import type { Db, DbLike, Tx } from '../db/client';
import type { Clock } from '../clock';
import type { CurrentLeadTier, LeadTier } from '@coldemail/shared';
import type { EventStore } from './eventStore';
import type { SequenceProvider } from '../scheduler/types';
import { getSettings } from '../db/repos/settingsRepo';
import { listMailboxesByStatus } from '../db/repos/mailboxesRepo';
import {
  coldStorageRows,
  countEnrolledSince,
  enrolledLeadIdsIn,
  insertEnrollments,
} from '../db/repos/enrollmentsRepo';
import { getCampaign, rampStagesOf, type RampStage } from '../db/repos/campaignsRepo';
import {
  leadsByIds,
  activeEnrollmentLeadIds,
  recontactStatusByLeadIds,
  selectEligibleLeads,
  type EligibleLead,
} from '../db/repos/leadsRepo';
import { leadsWithHashConflict } from '../db/repos/sentMessagesRepo';
import { allContentHashes } from '../domain/sequence';
import { localDayOrdinal, startOfLocalDay, startOfNextLocalDay } from '../scheduler/window';
import { buildEvent } from '../domain/events';
import { commitRecycle } from './recycling';
import {
  availablePoolLeads,
  availablePoolRowsForLeadIds,
  markPoolEligibility,
  markPoolEnrolled,
  poolSummary,
} from '../db/repos/campaignPoolRepo';
import { poolEligibility } from './campaignPools';
import { acquireEnrollmentCapacityLock, lockLead } from '../db/repos/locksRepo';
import { suppressedAmong } from '../db/repos/suppressionsRepo';
import { campaignPersonalizedCopyReadiness } from '../db/repos/manualDraftsRepo';
import { mailboxCapacity, reservedWork } from '../db/repos/sendingCapacityRepo';
import { AppError } from '../api/errors';

export interface EnrollmentDeps {
  /** Fixture-only: never configured by the API or production workers. */
  fixtureCapacityOverride?: boolean;
  db: Db;
  store: EventStore;
  clock: Clock;
  sequences: SequenceProvider;
}

export interface Capacity {
  total: number;
  sentSoFar: number;
  followupsDue: number;
  pendingOpeners: number;
  roomForNew: number;
  rampCap: number | null; // null = campaign out of ramp window (no ramp limit)
  suggested: number;
  rampDay: number | null;
  rampStage: RampStage | null;
  enrolledToday: number;
  effectiveDailyCap: number;
  campaignCapRemaining: number;
  poolAvailable: number | null;
}

export async function capacityToday(
  deps: { db: DbLike; clock: Clock },
  campaignId: number,
): Promise<Capacity> {
  const { db, clock } = deps;
  const now = clock.now();
  const settings = await getSettings(db);
  const midnight = startOfLocalDay(now, settings.defaultTimezone);

  const boxes = await listMailboxesByStatus(db, ['ok']);
  let total = 0;
  let sentSoFar = 0;
  let followupsDue = 0;
  let assignedOpeners = 0;
  let spare = 0;
  for (const mb of boxes) {
    const cap = await mailboxCapacity(db, mb, now);
    total += cap.total;
    sentSoFar += cap.sent;
    followupsDue += cap.followups;
    assignedOpeners += cap.openers;
    spare += cap.newSlots;
  }
  // An unassigned opener is one shared commitment, even with mixed mailbox timezones.
  const latestMidnight = boxes.reduce(
    (latest, mb) =>
      new Date(Math.max(latest.getTime(), startOfNextLocalDay(now, mb.timezone).getTime())),
    now,
  );
  const unassigned = (await reservedWork(db, latestMidnight)).openers;
  const pendingOpeners = assignedOpeners + unassigned;
  const roomForNew = Math.max(0, spare - unassigned);

  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const enrolledToday = await countEnrolledSince(db, campaignId, midnight);
  const activation = campaign.firstActivatedAt;
  const rampDay = activation
    ? Math.max(
        1,
        localDayOrdinal(now, settings.defaultTimezone) -
          localDayOrdinal(activation, settings.defaultTimezone) +
          1,
      )
    : null;
  const rampStage =
    rampDay === null
      ? null
      : (rampStagesOf(campaign).find(
          (stage) => rampDay >= stage.start_day && rampDay <= stage.end_day,
        ) ?? null);
  const rampCap = rampStage ? Math.max(0, rampStage.cap - enrolledToday) : null;
  const effectiveDailyCap = rampStage?.cap ?? campaign.steadyDailyEnrollCap;
  const campaignCapRemaining = Math.max(0, effectiveDailyCap - enrolledToday);
  const pool = campaign.leadSelectionMode === 'pool' ? await poolSummary(db, campaignId) : null;
  const suggested = Math.min(
    roomForNew,
    campaignCapRemaining,
    pool ? pool.available : Number.POSITIVE_INFINITY,
  );

  return {
    total,
    sentSoFar,
    followupsDue,
    pendingOpeners,
    roomForNew,
    rampCap,
    suggested,
    rampDay,
    rampStage,
    enrolledToday,
    effectiveDailyCap,
    campaignCapRemaining,
    poolAvailable: pool?.available ?? null,
  };
}

/** Requests above the current allowance reject atomically (409 capacity_exceeded). */
export class CapacityExceededError extends Error {
  readonly code = 'capacity_exceeded';
  constructor(
    readonly requested: number,
    readonly suggested: number,
  ) {
    super(
      `Only ${suggested} additional leads fit today. Reduce the enrollment count to ${suggested}.`,
    );
    this.name = 'CapacityExceededError';
  }
}

export interface SkippedBucket {
  reason: string;
  count: number;
}

export interface EnrollResult {
  enrolled: number;
  leadIds: number[];
  enrollmentIds: number[];
  /** docs/10 enroll response: why candidates were passed over. */
  skipped: SkippedBucket[];
}

/**
 * Count-based enrollment selects eligible leads (suppression, dedupe,
 * recycle guard, Nurture/Untiered exclusion, and personalized Step-1
 * readiness), Tier A→B oldest first. It appends `enrolled` with
 * next_send_at = now and the fixed tier mode. Production rejects count > suggested;
 * only the historical fixture harness can bypass daily space.
 */
export async function enroll(
  deps: EnrollmentDeps,
  campaignId: number,
  count: number,
  opts: { tier?: CurrentLeadTier; force?: boolean } = {},
): Promise<EnrollResult> {
  return deps.db.transaction(async (tx) => {
    await acquireEnrollmentCapacityLock(tx);
    const now = deps.clock.now();
    const cap = await capacityToday({ db: tx, clock: deps.clock }, campaignId);
    if (opts.force && !(deps.fixtureCapacityOverride && process.env.NODE_ENV === 'test'))
      throw new AppError(
        'validation',
        422,
        'Capacity overrides are unavailable. Enroll within the current allowance.',
      );
    const allowed = opts.force ? cap.campaignCapRemaining : cap.suggested;
    if (count > allowed) throw new CapacityExceededError(count, allowed);
    const campaign = await getCampaign(tx, campaignId);
    if (!campaign) throw new Error(`campaign ${campaignId} not found`);
    const seq = await deps.sequences.sequenceFor(campaignId);
    if (campaign.leadSelectionMode === 'pool') {
      const summary = await poolSummary(tx, campaignId);
      const candidates = await availablePoolLeads(tx, campaignId, summary.available);
      const checked = await poolEligibility(
        tx,
        deps.sequences,
        campaignId,
        candidates.map((candidate) => candidate.leadId),
        now,
        { requireTier: true },
      );
      const eligibleIds = new Set(checked.eligible.map((lead) => lead.id));
      for (const candidate of candidates) {
        await markPoolEligibility(
          tx,
          candidate.poolId,
          checked.reasons.get(candidate.leadId) ?? null,
          now,
        );
      }
      const selected = candidates
        .flatMap((candidate) =>
          eligibleIds.has(candidate.leadId) && (candidate.tier === 'A' || candidate.tier === 'B')
            ? [{ ...candidate, tier: candidate.tier }]
            : [],
        )
        .slice(0, count);
      const result = await enrollLeadsInTransaction(
        deps,
        tx,
        campaignId,
        selected.map((candidate) => ({ id: candidate.leadId, tier: candidate.tier })),
        now,
        new Map(selected.map((candidate) => [candidate.leadId, candidate.poolId])),
      );
      if (selected.length < count) {
        result.skipped.push({
          reason: 'insufficient_pooled_eligible',
          count: count - selected.length,
        });
      }
      return result;
    }
    let eligible = await selectEligibleLeads(
      tx,
      campaignId,
      allContentHashes(seq),
      Math.max(count, count * 10),
      opts.tier,
    );
    const firstStep = seq.steps.find((step) => step.stepNo === 1);
    if (firstStep?.contentSource === 'personalized' && firstStep.id) {
      const readiness = await campaignPersonalizedCopyReadiness(
        tx,
        campaignId,
        firstStep.id,
        eligible.map((lead) => lead.id),
      );
      const blocked = new Map<string, number>();
      eligible = eligible.filter((lead) => {
        const reason = readiness.get(lead.id);
        if (reason) blocked.set(reason, (blocked.get(reason) ?? 0) + 1);
        return !reason;
      });
      eligible = eligible.slice(0, count);
      const result = await enrollLeadsInTransaction(deps, tx, campaignId, eligible, now);
      result.skipped.push(
        ...[...blocked].map(([reason, blockedCount]) => ({ reason, count: blockedCount })),
      );
      if (eligible.length < count) {
        result.skipped.push({ reason: 'insufficient_eligible', count: count - eligible.length });
      }
      return result;
    }
    eligible = eligible.slice(0, count);
    const result = await enrollLeadsInTransaction(deps, tx, campaignId, eligible, now);
    if (eligible.length < count) {
      result.skipped.push({ reason: 'insufficient_eligible', count: count - eligible.length });
    }
    return result;
  });
}

/**
 * Explicit-ids enrollment (docs/10 `{lead_ids, force?}`): the deliberate-act
 * path — nurture leads ARE allowed here (docs/09 §4; bulk paths exclude
 * them). Every ineligible id is reported in `skipped` by reason instead of
 * silently dropped.
 */
export async function enrollByIds(
  deps: EnrollmentDeps,
  campaignId: number,
  leadIds: number[],
  opts: { force?: boolean; allowRecontact?: boolean } = {},
): Promise<EnrollResult> {
  return deps.db.transaction(async (tx) => {
    await acquireEnrollmentCapacityLock(tx);
    const now = deps.clock.now();

    const cap = await capacityToday({ db: tx, clock: deps.clock }, campaignId);
    if (opts.force && !(deps.fixtureCapacityOverride && process.env.NODE_ENV === 'test'))
      throw new AppError(
        'validation',
        422,
        'Capacity overrides are unavailable. Enroll within the current allowance.',
      );
    const allowed = opts.force ? cap.campaignCapRemaining : cap.suggested;
    if (leadIds.length > allowed) {
      throw new CapacityExceededError(leadIds.length, allowed);
    }

    const campaign = await getCampaign(tx, campaignId);
    if (!campaign) throw new Error(`campaign ${campaignId} not found`);
    const seq = await deps.sequences.sequenceFor(campaignId);

    const unique = [...new Set(leadIds)];
    for (const id of unique.slice().sort((a, b) => a - b)) await lockLead(tx, id);
    const poolRows =
      campaign.leadSelectionMode === 'pool'
        ? await availablePoolRowsForLeadIds(tx, campaignId, unique)
        : new Map<number, number>();
    const rows = await leadsByIds(tx, unique);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const already = await enrolledLeadIdsIn(tx, campaignId, unique);
    const activeElsewhere = await activeEnrollmentLeadIds(tx, unique, campaignId);
    const conflicted = await leadsWithHashConflict(tx, unique, allContentHashes(seq));
    const recontact = await recontactStatusByLeadIds(tx, unique);
    const firstStep = seq.steps.find((step) => step.stepNo === 1);
    const copyReadiness =
      firstStep?.contentSource === 'personalized' && firstStep.id
        ? await campaignPersonalizedCopyReadiness(tx, campaignId, firstStep.id, unique)
        : new Map<number, string | null>();

    const skippedCounts = new Map<string, number>();
    const skip = (reason: string) =>
      skippedCounts.set(reason, (skippedCounts.get(reason) ?? 0) + 1);

    const eligible: EligibleLead[] = [];
    for (const id of unique) {
      const lead = byId.get(id);
      if (!lead) skip('not_found');
      else if (campaign.leadSelectionMode === 'pool' && !poolRows.has(id))
        skip('not_in_campaign_pool');
      else if (lead.isSuppressed) skip('suppressed');
      else if (already.has(id)) skip('already_enrolled');
      else if (activeElsewhere.has(id)) skip('active_enrollment_elsewhere');
      else if (conflicted.has(id)) skip('content_hash_conflict');
      else if (recontact.get(id)?.hasStop) skip('prior_incoming_email_stop');
      else if (recontact.get(id)?.hasReply && !opts.allowRecontact) skip('prior_human_reply');
      else if (recontact.get(id)?.hasUndispositionedReply) skip('reply_needs_disposition');
      else if ((recontact.get(id)?.blockedUntil?.getTime() ?? 0) > now.getTime())
        skip('recontact_not_due');
      else if (lead.outreachStatus === 'nurture') skip('nurture');
      else if (lead.tier !== 'A' && lead.tier !== 'B') skip('untiered');
      else if (copyReadiness.get(id)) skip(copyReadiness.get(id)!);
      else eligible.push({ id: lead.id, tier: lead.tier });
    }

    const result = await enrollLeadsInTransaction(
      deps,
      tx,
      campaignId,
      eligible,
      now,
      poolRows,
      opts.allowRecontact ?? false,
    );
    result.skipped.push(
      ...[...skippedCounts.entries()].map(([reason, count]) => ({ reason, count })),
    );
    return result;
  });
}

/** Shared tail of enroll + recycle: enrollment rows + `enrolled` events + next_send_at=now. */
export async function enrollLeadsInTransaction(
  deps: EnrollmentDeps,
  tx: Tx,
  campaignId: number,
  eligible: EligibleLead[],
  now: Date,
  poolIdsByLead: ReadonlyMap<number, number> = new Map(),
  allowRecontact = false,
): Promise<EnrollResult> {
  const { store } = deps;
  if (eligible.length === 0) return { enrolled: 0, leadIds: [], enrollmentIds: [], skipped: [] };
  for (const id of eligible.map((l) => l.id).sort((a, b) => a - b)) await lockLead(tx, id);
  const current = await leadsByIds(
    tx,
    eligible.map((l) => l.id),
  );
  const blockedAddresses = await suppressedAmong(
    tx,
    current.map((l) => l.email),
  );
  const recontact = await recontactStatusByLeadIds(
    tx,
    eligible.map((l) => l.id),
  );
  const active = await activeEnrollmentLeadIds(
    tx,
    eligible.map((l) => l.id),
  );
  const before = eligible.length;
  eligible = eligible.filter((l) => {
    const row = current.find((r) => r.id === l.id);
    const status = recontact.get(l.id);
    return (
      !!row &&
      !row.isSuppressed &&
      !blockedAddresses.has(row.email) &&
      !active.has(l.id) &&
      !status?.hasStop &&
      !(status?.hasReply && !allowRecontact) &&
      !status?.hasUndispositionedReply &&
      !(status?.blockedUntil && status.blockedUntil > now)
    );
  });
  if (!eligible.length)
    return {
      enrolled: 0,
      leadIds: [],
      enrollmentIds: [],
      skipped: [{ reason: 'eligibility_changed', count: before }],
    };

  const modeFor = (tier: CurrentLeadTier | null) =>
    tier === 'A' ? 'template_researched' : 'template_auto';

  const enrollmentIds = await insertEnrollments(
    tx,
    eligible.map((l) => ({
      leadId: l.id,
      campaignId,
      enrolledTier: l.tier,
      personalizationMode: modeFor(l.tier),
      enrolledAt: now,
    })),
  );

  await store.appendInTransaction(
    tx,
    eligible.map((l, i) =>
      buildEvent.enrolled({
        leadId: l.id,
        enrollmentId: enrollmentIds[i]!,
        campaignId,
        occurredAt: now,
      }),
    ),
    { patches: enrollmentIds.map((id) => ({ enrollmentId: id, nextSendAt: now })) },
  );

  if (poolIdsByLead.size > 0) {
    await markPoolEnrolled(
      tx,
      eligible.flatMap((lead, index) => {
        const poolId = poolIdsByLead.get(lead.id);
        return poolId === undefined ? [] : [{ poolId, enrollmentId: enrollmentIds[index]! }];
      }),
      now,
    );
  }

  return {
    enrolled: eligible.length,
    leadIds: eligible.map((l) => l.id),
    enrollmentIds,
    skipped:
      before > eligible.length
        ? [{ reason: 'eligibility_changed', count: before - eligible.length }]
        : [],
  };
}

// ── Cold storage & recycling (B5.7, docs/09 §6, walkthrough Stage 9) ────────

export interface ColdStorageItem {
  leadId: number;
  email: string;
  tier: LeadTier | null;
  completedAt: Date;
  earliestRecycleAt: Date;
  eligible: boolean;
}

/** COMPLETED leads of a source campaign with their rest-day gate status. */
export async function coldStorage(
  deps: Pick<EnrollmentDeps, 'db' | 'clock'>,
  sourceCampaignId: number,
): Promise<ColdStorageItem[]> {
  const { db, clock } = deps;
  const now = clock.now();
  const settings = await getSettings(db);
  const restMs = settings.coldStorageRestDays * 86_400_000;
  return (await coldStorageRows(db, sourceCampaignId)).map((r) => {
    const earliestRecycleAt = new Date(r.completedAt.getTime() + restMs);
    return { ...r, earliestRecycleAt, eligible: earliestRecycleAt.getTime() <= now.getTime() };
  });
}

/**
 * Recycle a source campaign's rested cold-storage leads into a DRAFT target
 * Compatibility wrapper for the original single-source service call. The new
 * implementation rechecks eligibility and skips conflicting leads atomically.
 */
export async function recycle(
  deps: EnrollmentDeps,
  targetCampaignId: number,
  sourceCampaignId: number,
): Promise<EnrollResult> {
  const result = await commitRecycle(deps, targetCampaignId, [sourceCampaignId]);
  return {
    enrolled: result.enrolled,
    leadIds: result.leadIds,
    enrollmentIds: result.enrollmentIds,
    skipped: result.skipped,
  };
}
