// Capacity + enrollment (B3.9, docs/06 §7, walkthrough Stages 5/8).
import type { Db } from '../db/client';
import type { Clock } from '../clock';
import type { LeadTier } from '@coldemail/shared';
import type { EventStore } from './eventStore';
import type { SequenceProvider } from '../scheduler/types';
import { getSettings } from '../db/repos/settingsRepo';
import { listMailboxesByStatus } from '../db/repos/mailboxesRepo';
import { countSentSince } from '../db/repos/eventsRepo';
import {
  coldStorageRows,
  countEnrolledSince,
  countFollowupsDue,
  enrolledLeadIdsIn,
  insertEnrollments,
} from '../db/repos/enrollmentsRepo';
import { getCampaign, rampStagesOf, tierEffortOf, type RampStage } from '../db/repos/campaignsRepo';
import {
  leadsByIds,
  recontactStatusByLeadIds,
  selectEligibleLeads,
  type EligibleLead,
} from '../db/repos/leadsRepo';
import { leadsWithHashConflict } from '../db/repos/sentMessagesRepo';
import { allContentHashes } from '../domain/sequence';
import { startOfLocalDay } from '../scheduler/window';
import { buildEvent } from '../domain/events';
import { commitRecycle } from './recycling';

export interface EnrollmentDeps {
  db: Db;
  store: EventStore;
  clock: Clock;
  sequences: SequenceProvider;
}

export interface Capacity {
  total: number;
  sentSoFar: number;
  followupsDue: number;
  roomForNew: number;
  rampCap: number | null; // null = campaign out of ramp window (no ramp limit)
  suggested: number;
  rampDay: number | null;
  rampStage: RampStage | null;
  enrolledToday: number;
}

export async function capacityToday(
  deps: Pick<EnrollmentDeps, 'db' | 'clock'>,
  campaignId: number,
): Promise<Capacity> {
  const { db, clock } = deps;
  const now = clock.now();
  const settings = await getSettings(db);
  const midnight = startOfLocalDay(now, settings.defaultTimezone);
  const endOfDay = new Date(midnight.getTime() + 86_400_000);

  const boxes = await listMailboxesByStatus(db, ['ok']);
  let total = 0;
  let sentSoFar = 0;
  for (const mb of boxes) {
    total += mb.resumeCap ?? mb.dailyCap;
    sentSoFar += await countSentSince(
      db,
      mb.id,
      startOfLocalDay(now, mb.timezone || settings.defaultTimezone),
    );
  }
  const followupsDue = await countFollowupsDue(db, endOfDay);
  const roomForNew = Math.max(0, total - sentSoFar - followupsDue);

  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const enrolledToday = await countEnrolledSince(db, campaignId, midnight);
  const activation = campaign.firstActivatedAt;
  const rampDay = activation
    ? Math.max(
        1,
        Math.floor(
          (startOfLocalDay(now, settings.defaultTimezone).getTime() -
            startOfLocalDay(activation, settings.defaultTimezone).getTime()) /
            86_400_000,
        ) + 1,
      )
    : null;
  const rampStage =
    rampDay === null
      ? null
      : (rampStagesOf(campaign).find(
          (stage) => rampDay >= stage.start_day && rampDay <= stage.end_day,
        ) ?? null);
  const rampCap = rampStage ? Math.max(0, rampStage.cap - enrolledToday) : null;

  return {
    total,
    sentSoFar,
    followupsDue,
    roomForNew,
    rampCap,
    suggested: rampCap === null ? roomForNew : Math.min(roomForNew, rampCap),
    rampDay,
    rampStage,
    enrolledToday,
  };
}

/** count > suggested without force (docs/10: 409 capacity_exceeded). */
export class CapacityExceededError extends Error {
  readonly code = 'capacity_exceeded';
  constructor(
    readonly requested: number,
    readonly suggested: number,
  ) {
    super(
      `enroll count ${requested} exceeds suggested capacity ${suggested} (use force to override)`,
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
 * Count-based enrollment: selects eligible leads (suppression, dedupe,
 * recycle guard, nurture exclusion — enforced in SQL), tier order A→B→C→
 * untiered, oldest first; appends `enrolled` per lead with next_send_at = now
 * and personalization_mode from tier_effort_config. Rejects count > suggested
 * unless force.
 */
export async function enroll(
  deps: EnrollmentDeps,
  campaignId: number,
  count: number,
  opts: { tier?: LeadTier; force?: boolean } = {},
): Promise<EnrollResult> {
  const { db, clock, sequences } = deps;
  const now = clock.now();

  if (!opts.force) {
    const cap = await capacityToday(deps, campaignId);
    if (count > cap.suggested) {
      throw new CapacityExceededError(count, cap.suggested);
    }
  }

  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const seq = await sequences.sequenceFor(campaignId);

  const eligible = await selectEligibleLeads(
    db,
    campaignId,
    allContentHashes(seq),
    count,
    opts.tier,
  );
  const result = await enrollLeads(deps, campaignId, eligible, now);
  if (eligible.length < count) {
    result.skipped.push({ reason: 'insufficient_eligible', count: count - eligible.length });
  }
  return result;
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
  const { db, clock, sequences } = deps;
  const now = clock.now();

  if (!opts.force) {
    const cap = await capacityToday(deps, campaignId);
    if (leadIds.length > cap.suggested) {
      throw new CapacityExceededError(leadIds.length, cap.suggested);
    }
  }

  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const seq = await sequences.sequenceFor(campaignId);

  const unique = [...new Set(leadIds)];
  const rows = await leadsByIds(db, unique);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const already = await enrolledLeadIdsIn(db, campaignId, unique);
  const conflicted = await leadsWithHashConflict(db, unique, allContentHashes(seq));
  const recontact = await recontactStatusByLeadIds(db, unique);

  const skippedCounts = new Map<string, number>();
  const skip = (reason: string) => skippedCounts.set(reason, (skippedCounts.get(reason) ?? 0) + 1);

  const eligible: EligibleLead[] = [];
  for (const id of unique) {
    const lead = byId.get(id);
    if (!lead) skip('not_found');
    else if (lead.isSuppressed) skip('suppressed');
    else if (already.has(id)) skip('already_enrolled');
    else if (conflicted.has(id)) skip('content_hash_conflict');
    else if (recontact.get(id)?.hasReply && !opts.allowRecontact) skip('prior_human_reply');
    else if (recontact.get(id)?.hasUndispositionedReply) skip('reply_needs_disposition');
    else if ((recontact.get(id)?.blockedUntil?.getTime() ?? 0) > now.getTime())
      skip('recontact_not_due');
    else eligible.push({ id: lead.id, tier: lead.tier });
  }

  const result = await enrollLeads(deps, campaignId, eligible, now);
  result.skipped.push(
    ...[...skippedCounts.entries()].map(([reason, count]) => ({ reason, count })),
  );
  return result;
}

/** Shared tail of enroll + recycle: enrollment rows + `enrolled` events + next_send_at=now. */
async function enrollLeads(
  deps: EnrollmentDeps,
  campaignId: number,
  eligible: EligibleLead[],
  now: Date,
): Promise<EnrollResult> {
  const { db, store } = deps;
  if (eligible.length === 0) return { enrolled: 0, leadIds: [], enrollmentIds: [], skipped: [] };

  const campaign = await getCampaign(db, campaignId);
  const effort = tierEffortOf(campaign!);
  const modeFor = (tier: LeadTier | null) =>
    tier === null || tier === 'nurture' ? 'template_auto' : effort[tier];

  const enrollmentIds = await insertEnrollments(
    db,
    eligible.map((l) => ({
      leadId: l.id,
      campaignId,
      enrolledTier: l.tier,
      personalizationMode: modeFor(l.tier),
      enrolledAt: now,
    })),
  );

  await store.append(
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

  return {
    enrolled: eligible.length,
    leadIds: eligible.map((l) => l.id),
    enrollmentIds,
    skipped: [],
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
