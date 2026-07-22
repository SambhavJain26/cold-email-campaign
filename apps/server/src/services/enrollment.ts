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
import { getCampaign, rampOf, setRecycledFrom, tierEffortOf } from '../db/repos/campaignsRepo';
import { selectEligibleLeads, type EligibleLead } from '../db/repos/leadsRepo';
import { hashesReceivedByLeads } from '../db/repos/sentMessagesRepo';
import { allContentHashes, type SequenceDef } from '../domain/sequence';
import { startOfLocalDay } from '../scheduler/window';
import { buildEvent } from '../domain/events';

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
}

export async function capacityToday(deps: EnrollmentDeps, campaignId: number): Promise<Capacity> {
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
    sentSoFar += await countSentSince(db, mb.id, midnight);
  }
  const followupsDue = await countFollowupsDue(db, endOfDay);
  const roomForNew = Math.max(0, total - sentSoFar - followupsDue);

  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const ramp = rampOf(campaign);
  const inRampWindow = now.getTime() - campaign.createdAt.getTime() < ramp.ramp_days * 86_400_000;
  const rampCap = inRampWindow
    ? Math.max(0, ramp.ramp_daily_enroll_cap - (await countEnrolledSince(db, campaignId, midnight)))
    : null;

  return {
    total,
    sentSoFar,
    followupsDue,
    roomForNew,
    rampCap,
    suggested: rampCap === null ? roomForNew : Math.min(roomForNew, rampCap),
  };
}

export interface EnrollResult {
  enrolled: number;
  leadIds: number[];
  enrollmentIds: number[];
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
      throw new Error(
        `enroll count ${count} exceeds suggested capacity ${cap.suggested} (use force to override)`,
      );
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
  return enrollLeads(deps, campaignId, eligible, now);
}

/** Shared tail of enroll + recycle: enrollment rows + `enrolled` events + next_send_at=now. */
async function enrollLeads(
  deps: EnrollmentDeps,
  campaignId: number,
  eligible: EligibleLead[],
  now: Date,
): Promise<EnrollResult> {
  const { db, store } = deps;
  if (eligible.length === 0) return { enrolled: 0, leadIds: [], enrollmentIds: [] };

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

  return { enrolled: eligible.length, leadIds: eligible.map((l) => l.id), enrollmentIds };
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

/** docs/09 §6: "Do NOT resend the same emails" as a hard rule, not advice. */
export class RecycleSequenceConflictError extends Error {
  readonly code = 'recycle_sequence_conflict';
  constructor(readonly stepNos: number[]) {
    super(
      `recycle_sequence_conflict: target sequence step(s) ${stepNos.join(', ')} ` +
        `contain content these leads already received — change the templates first`,
    );
  }
}

/**
 * Recycle a source campaign's rested cold-storage leads into a DRAFT target
 * campaign (fresh enrollments; the old ones stay COMPLETED — the per-campaign
 * state machine is what makes this work). Blocks whole-action on the
 * content-hash guard, listing the offending steps.
 */
export async function recycle(
  deps: EnrollmentDeps,
  targetCampaignId: number,
  sourceCampaignId: number,
): Promise<EnrollResult> {
  const { db, clock, sequences } = deps;
  const now = clock.now();

  const target = await getCampaign(db, targetCampaignId);
  if (!target) throw new Error(`campaign ${targetCampaignId} not found`);
  if (target.status !== 'draft') {
    throw new Error(`recycle targets a draft campaign; ${targetCampaignId} is ${target.status}`);
  }
  const seq = await sequences.sequenceFor(targetCampaignId);

  // Rest-day gate; nurture stays out of BULK enrollment (docs/09 §4 — a
  // nurture lead is enrollable only via explicit leadIds, a deliberate act).
  const rested = (await coldStorage(deps, sourceCampaignId)).filter(
    (s) => s.eligible && s.tier !== 'nurture',
  );
  const already = await enrolledLeadIdsIn(
    db,
    targetCampaignId,
    rested.map((s) => s.leadId),
  );
  const candidates = rested.filter((s) => !already.has(s.leadId));
  if (candidates.length === 0) return { enrolled: 0, leadIds: [], enrollmentIds: [] };

  await assertNoHashConflict(
    db,
    seq,
    candidates.map((c) => c.leadId),
  );

  const result = await enrollLeads(
    deps,
    targetCampaignId,
    candidates.map((c) => ({ id: c.leadId, tier: c.tier })),
    now,
  );
  await setRecycledFrom(db, targetCampaignId, sourceCampaignId);
  return result;
}

async function assertNoHashConflict(
  db: EnrollmentDeps['db'],
  seq: SequenceDef,
  leadIds: number[],
): Promise<void> {
  const received = await hashesReceivedByLeads(db, leadIds, allContentHashes(seq));
  if (received.size === 0) return;
  const stepNos = [
    ...new Set(
      seq.steps
        .filter((s) => s.variants.some((v) => received.has(v.contentHash)))
        .map((s) => s.stepNo),
    ),
  ].sort((a, b) => a - b);
  throw new RecycleSequenceConflictError(stepNos);
}
