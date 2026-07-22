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
  countEnrolledSince,
  countFollowupsDue,
  insertEnrollments,
} from '../db/repos/enrollmentsRepo';
import { getCampaign, rampOf, tierEffortOf } from '../db/repos/campaignsRepo';
import { selectEligibleLeads } from '../db/repos/leadsRepo';
import { allContentHashes } from '../domain/sequence';
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
  const { db, store, clock, sequences } = deps;
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
  const effort = tierEffortOf(campaign);
  const seq = await sequences.sequenceFor(campaignId);

  const eligible = await selectEligibleLeads(
    db,
    campaignId,
    allContentHashes(seq),
    count,
    opts.tier,
  );
  if (eligible.length === 0) return { enrolled: 0, leadIds: [], enrollmentIds: [] };

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
