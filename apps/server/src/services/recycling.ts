import type { CurrentLeadTier } from '@coldemail/shared';
import type { Clock } from '../clock';
import type { Db, DbLike } from '../db/client';
import { enrolledLeadIdsIn, insertEnrollments } from '../db/repos/enrollmentsRepo';
import { getCampaign } from '../db/repos/campaignsRepo';
import { recontactStatusByLeadIds } from '../db/repos/leadsRepo';
import { leadsWithHashConflict } from '../db/repos/sentMessagesRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { loadSequenceDef } from '../db/repos/sequencesRepo';
import {
  addCampaignRecycleSources,
  addRecycleEnrollmentSources,
  completedSourceEnrollments,
  existingCampaignIds,
  lockRecycleTarget,
  recycleSourcesByTargetIds,
  setLegacyRecycleSource,
  type SourceEnrollmentCandidate,
} from '../db/repos/recyclingRepo';
import { allContentHashes } from '../domain/sequence';
import { campaignPersonalizedCopyReadiness } from '../db/repos/manualDraftsRepo';
import { buildEvent } from '../domain/events';
import type { EventStore } from './eventStore';

export interface RecycleBreakdown {
  uniqueLeads: number;
  duplicates: number;
  restPeriodFailures: number;
  nurtureExclusions: number;
  untieredExclusions: number;
  personalizedCopyBlocks: number;
  suppressionRecontactBlocks: number;
  existingTargetEnrollments: number;
  priorContentConflicts: number;
  eligible: number;
}

export interface RecycleSourceContribution {
  sourceCampaignId: number;
  name: string;
  candidates: number;
  eligible: number;
}

export interface RecyclePreview {
  breakdown: RecycleBreakdown;
  sources: RecycleSourceContribution[];
}

export interface RecycleCommitResult extends RecyclePreview {
  enrolled: number;
  leadIds: number[];
  enrollmentIds: number[];
  skipped: Array<{ reason: string; count: number }>;
}

export class RecycleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecycleValidationError';
  }
}

interface EligibleRecycleLead {
  leadId: number;
  tier: CurrentLeadTier;
  sources: SourceEnrollmentCandidate[];
}

interface EvaluatedRecycle extends RecyclePreview {
  eligibleLeads: EligibleRecycleLead[];
}

async function evaluateRecycle(
  db: DbLike,
  now: Date,
  targetCampaignId: number,
  sourceCampaignIds: readonly number[],
): Promise<EvaluatedRecycle> {
  const sourceIds = [...new Set(sourceCampaignIds)].toSorted((a, b) => a - b);
  if (sourceIds.length === 0) throw new RecycleValidationError('at least one source is required');
  if (sourceIds.includes(targetCampaignId)) {
    throw new RecycleValidationError('the target campaign cannot also be a recycle source');
  }
  const existingSources = await existingCampaignIds(db, sourceIds);
  if (existingSources.size !== sourceIds.length) {
    throw new RecycleValidationError('one or more source campaigns do not exist');
  }

  const target = await getCampaign(db, targetCampaignId);
  if (!target) throw new RecycleValidationError('target campaign does not exist');
  if (target.status !== 'draft') {
    throw new RecycleValidationError('recycle target must remain a draft campaign');
  }
  if (target.sequenceId === null) {
    throw new RecycleValidationError('recycle target must have a sequence');
  }
  const sequence = await loadSequenceDef(db, target.sequenceId);
  if (!sequence) throw new RecycleValidationError('recycle target sequence does not exist');

  // `db` may be a caller-owned transaction; keep queries serial because a
  // single pg transaction client cannot execute overlapping statements.
  const settings = await getSettings(db);
  const candidates = await completedSourceEnrollments(db, sourceIds);
  const byLead = new Map<number, SourceEnrollmentCandidate[]>();
  for (const candidate of candidates) {
    const rows = byLead.get(candidate.leadId) ?? [];
    rows.push(candidate);
    byLead.set(candidate.leadId, rows);
  }
  const leadIds = [...byLead.keys()];
  const already = await enrolledLeadIdsIn(db, targetCampaignId, leadIds);
  const conflicts = await leadsWithHashConflict(db, leadIds, allContentHashes(sequence));
  const recontact = await recontactStatusByLeadIds(db, leadIds);
  const firstStep = sequence.steps[0];
  const copyReadiness =
    firstStep?.contentSource === 'personalized' && firstStep.id !== undefined
      ? await campaignPersonalizedCopyReadiness(db, targetCampaignId, firstStep.id, leadIds)
      : new Map<number, null>();
  const restMs = settings.coldStorageRestDays * 86_400_000;
  const breakdown: RecycleBreakdown = {
    uniqueLeads: leadIds.length,
    duplicates: candidates.length - leadIds.length,
    restPeriodFailures: 0,
    nurtureExclusions: 0,
    untieredExclusions: 0,
    personalizedCopyBlocks: 0,
    suppressionRecontactBlocks: 0,
    existingTargetEnrollments: 0,
    priorContentConflicts: 0,
    eligible: 0,
  };
  const eligibleLeads: EligibleRecycleLead[] = [];

  for (const [leadId, rows] of byLead) {
    const lead = rows[0]!;
    const status = recontact.get(leadId);
    const blocked =
      lead.isSuppressed ||
      lead.isErased ||
      status?.hasStop === true ||
      status?.hasReply === true ||
      status?.hasUndispositionedReply === true ||
      (status?.blockedUntil?.getTime() ?? 0) > now.getTime();
    const restedSources = rows.filter((row) => row.completedAt.getTime() + restMs <= now.getTime());
    if (blocked) breakdown.suppressionRecontactBlocks += 1;
    else if (already.has(leadId)) breakdown.existingTargetEnrollments += 1;
    else if (lead.outreachStatus === 'nurture') breakdown.nurtureExclusions += 1;
    else if (lead.tier === null || (lead.tier !== 'A' && lead.tier !== 'B'))
      breakdown.untieredExclusions += 1;
    else if (copyReadiness.get(leadId)) breakdown.personalizedCopyBlocks += 1;
    else if (restedSources.length === 0) breakdown.restPeriodFailures += 1;
    else if (conflicts.has(leadId)) breakdown.priorContentConflicts += 1;
    else {
      breakdown.eligible += 1;
      eligibleLeads.push({ leadId, tier: lead.tier, sources: restedSources });
    }
  }

  const campaignsById = new Map<number, NonNullable<Awaited<ReturnType<typeof getCampaign>>>>();
  for (const sourceId of sourceIds) {
    campaignsById.set(sourceId, (await getCampaign(db, sourceId))!);
  }
  const sources = sourceIds.map((sourceCampaignId) => ({
    sourceCampaignId,
    name: campaignsById.get(sourceCampaignId)!.name,
    candidates: new Set(
      candidates
        .filter((row) => row.sourceCampaignId === sourceCampaignId)
        .map((row) => row.leadId),
    ).size,
    eligible: new Set(
      eligibleLeads
        .filter((lead) =>
          lead.sources.some((source) => source.sourceCampaignId === sourceCampaignId),
        )
        .map((lead) => lead.leadId),
    ).size,
  }));
  return { breakdown, sources, eligibleLeads };
}

export async function previewRecycle(
  deps: { db: Db; clock: Clock },
  targetCampaignId: number,
  sourceCampaignIds: readonly number[],
): Promise<RecyclePreview> {
  const { eligibleLeads: _eligibleLeads, ...preview } = await evaluateRecycle(
    deps.db,
    deps.clock.now(),
    targetCampaignId,
    sourceCampaignIds,
  );
  return preview;
}

export async function commitRecycle(
  deps: { db: Db; clock: Clock; store: EventStore },
  targetCampaignId: number,
  sourceCampaignIds: readonly number[],
): Promise<RecycleCommitResult> {
  const now = deps.clock.now();
  return deps.db.transaction(
    async (tx) => {
      await lockTargetCampaign(tx, targetCampaignId);
      const evaluated = await evaluateRecycle(tx, now, targetCampaignId, sourceCampaignIds);
      const modeFor = (tier: CurrentLeadTier) =>
        tier === 'A' ? 'template_researched' : 'template_auto';
      const enrollmentIds = await insertEnrollments(
        tx,
        evaluated.eligibleLeads.map((lead) => ({
          leadId: lead.leadId,
          campaignId: targetCampaignId,
          enrolledTier: lead.tier,
          personalizationMode: modeFor(lead.tier),
          enrolledAt: now,
        })),
      );
      if (enrollmentIds.length > 0) {
        await deps.store.appendInTransaction(
          tx,
          evaluated.eligibleLeads.map((lead, index) =>
            buildEvent.enrolled({
              leadId: lead.leadId,
              enrollmentId: enrollmentIds[index]!,
              campaignId: targetCampaignId,
              occurredAt: now,
            }),
          ),
          {
            patches: enrollmentIds.map((enrollmentId) => ({ enrollmentId, nextSendAt: now })),
          },
        );
      }
      const sourceIds = [...new Set(sourceCampaignIds)].toSorted((a, b) => a - b);
      await addCampaignRecycleSources(tx, targetCampaignId, sourceIds, now);
      await addRecycleEnrollmentSources(
        tx,
        evaluated.eligibleLeads.flatMap((lead, index) =>
          lead.sources.map((source) => ({
            targetEnrollmentId: enrollmentIds[index]!,
            sourceCampaignId: source.sourceCampaignId,
            sourceEnrollmentId: source.sourceEnrollmentId,
            createdAt: now,
          })),
        ),
      );

      const provenance = (await recycleSourcesByTargetIds(tx, [targetCampaignId])).get(
        targetCampaignId,
      );
      await setLegacyRecycleSource(
        tx,
        targetCampaignId,
        provenance?.length === 1 ? provenance[0]!.campaignId : null,
      );

      const skipped = [
        ['rest_period', evaluated.breakdown.restPeriodFailures],
        ['nurture', evaluated.breakdown.nurtureExclusions],
        ['untiered', evaluated.breakdown.untieredExclusions],
        ['personalized_copy', evaluated.breakdown.personalizedCopyBlocks],
        ['suppression_or_recontact', evaluated.breakdown.suppressionRecontactBlocks],
        ['already_enrolled', evaluated.breakdown.existingTargetEnrollments],
        ['content_hash_conflict', evaluated.breakdown.priorContentConflicts],
      ]
        .filter((entry): entry is [string, number] => Number(entry[1]) > 0)
        .map(([reason, count]) => ({ reason, count }));
      return {
        breakdown: evaluated.breakdown,
        sources: evaluated.sources,
        enrolled: enrollmentIds.length,
        leadIds: evaluated.eligibleLeads.map((lead) => lead.leadId),
        enrollmentIds,
        skipped,
      };
    },
    { isolationLevel: 'serializable' },
  );
}

async function lockTargetCampaign(db: DbLike, targetCampaignId: number): Promise<void> {
  if (!(await lockRecycleTarget(db, targetCampaignId))) {
    throw new RecycleValidationError('target campaign does not exist');
  }
}
