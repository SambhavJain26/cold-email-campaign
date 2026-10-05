import type { LeadTier } from '@coldemail/shared';
import type { DbLike } from '../db/client';
import {
  activePoolCampaignForLeads,
  allocatePoolLeads,
  availablePoolLeadIds,
  releasePoolLeads,
  setCampaignPoolMode,
} from '../db/repos/campaignPoolRepo';
import { getCampaign, lockCampaignForImport } from '../db/repos/campaignsRepo';
import { enrolledLeadIdsIn } from '../db/repos/enrollmentsRepo';
import {
  activeEnrollmentLeadIds,
  leadsByIds,
  poolAllocationCandidates,
  recontactStatusByLeadIds,
} from '../db/repos/leadsRepo';
import { leadsWithHashConflict } from '../db/repos/sentMessagesRepo';
import { allContentHashes } from '../domain/sequence';
import type { SequenceProvider } from '../scheduler/types';
import { acquireEnrollmentCapacityLock } from '../db/repos/locksRepo';
import {
  campaignPersonalizedCopyReadiness,
  createOrReplaceCampaignPersonalizedCopy,
  personalizedCopySourcesForLeads,
} from '../db/repos/manualDraftsRepo';
import { contentHashOf } from '../render/hash';

async function bindSourcesOnAssignment(
  db: DbLike,
  sequences: SequenceProvider,
  campaignId: number,
  leadIds: readonly number[],
  now: Date,
): Promise<void> {
  const sequence = await sequences.sequenceFor(campaignId);
  const personalizedSteps = sequence.steps.filter(
    (step) => step.contentSource === 'personalized' && step.id !== undefined,
  );
  if (personalizedSteps.length === 0) return;
  for (const source of await personalizedCopySourcesForLeads(db, leadIds)) {
    const target =
      source.targetStepNo === null
        ? personalizedSteps.length === 1
          ? personalizedSteps[0]
          : undefined
        : personalizedSteps.find((step) => step.stepNo === source.targetStepNo);
    if (!target?.id) continue;
    await createOrReplaceCampaignPersonalizedCopy(db, {
      leadId: source.leadId,
      campaignId,
      sequenceStepId: target.id,
      stepNo: target.stepNo,
      sourceCopyId: source.id,
      sourceImportId: source.sourceImportId,
      subject: source.subject,
      body: source.body,
      contentHash: contentHashOf(source.subject, source.body),
      status: source.status,
      replace: false,
      at: now,
    });
  }
}

export interface PoolAllocationRequest {
  campaignId: number;
  count: number;
}

export interface PoolEligibilityResult {
  eligible: Array<{ id: number; tier: LeadTier | null }>;
  reasons: Map<number, string>;
}

export class PoolAllocationError extends Error {
  readonly code = 'pool_allocation_changed';
  constructor(message: string) {
    super(message);
    this.name = 'PoolAllocationError';
  }
}

export async function poolEligibility(
  db: DbLike,
  sequences: SequenceProvider,
  campaignId: number,
  leadIds: readonly number[],
  now: Date,
  options: { requireTier?: boolean } = {},
): Promise<PoolEligibilityResult> {
  const campaign = await getCampaign(db, campaignId);
  if (!campaign) throw new PoolAllocationError(`campaign ${campaignId} not found`);
  if (campaign.status !== 'draft' && campaign.status !== 'paused' && campaign.status !== 'active') {
    throw new PoolAllocationError('archived campaigns cannot receive or consume a lead pool');
  }
  const unique = [...new Set(leadIds)];
  const rows = await leadsByIds(db, unique);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const reserved = await activePoolCampaignForLeads(db, unique);
  const activeElsewhere = await activeEnrollmentLeadIds(db, unique, campaignId);
  const already = await enrolledLeadIdsIn(db, campaignId, unique);
  const recontact = await recontactStatusByLeadIds(db, unique);
  const sequence = await sequences.sequenceFor(campaignId);
  const conflicts = await leadsWithHashConflict(db, unique, allContentHashes(sequence));
  const firstStep = sequence.steps.find((step) => step.stepNo === 1);
  const copyReadiness =
    options.requireTier && firstStep?.contentSource === 'personalized' && firstStep.id
      ? await campaignPersonalizedCopyReadiness(db, campaignId, firstStep.id, unique)
      : new Map<number, string | null>();

  const eligible: PoolEligibilityResult['eligible'] = [];
  const reasons = new Map<number, string>();
  for (const id of unique) {
    const lead = byId.get(id);
    let reason: string | null = null;
    if (!lead) reason = 'not_found';
    else if (lead.isSuppressed) reason = 'suppressed';
    else if (lead.isErased) reason = 'erased';
    else if (lead.outreachStatus === 'nurture') reason = 'nurture';
    else if (options.requireTier && lead.tier !== 'A' && lead.tier !== 'B') reason = 'untiered';
    else if (copyReadiness.get(id)) reason = copyReadiness.get(id)!;
    else if (reserved.has(id) && reserved.get(id) !== campaignId) reason = 'reserved_elsewhere';
    else if (activeElsewhere.has(id)) reason = 'active_enrollment_elsewhere';
    else if (already.has(id)) reason = 'already_enrolled';
    else if (conflicts.has(id)) reason = 'content_hash_conflict';
    else if (recontact.get(id)?.hasReply) reason = 'prior_human_reply';
    else if (recontact.get(id)?.hasUndispositionedReply) reason = 'reply_needs_disposition';
    else if ((recontact.get(id)?.blockedUntil?.getTime() ?? 0) > now.getTime())
      reason = 'recontact_not_due';
    if (reason) reasons.set(id, reason);
    else eligible.push({ id, tier: lead!.tier });
  }
  return { eligible, reasons };
}

export interface ExactPoolAllocationResult {
  byCampaign: Array<{
    campaignId: number;
    requested: number;
    allocated: number;
    draftReserved: number;
    leadIds: number[];
  }>;
  allocatedLeadIds: number[];
  exclusions: Record<string, number>;
}

export async function allocateExactPools(
  db: DbLike,
  sequences: SequenceProvider,
  input: {
    requests: readonly PoolAllocationRequest[];
    candidateLeadIds: readonly number[];
    draftCampaignId?: number;
    draftLeadIds?: readonly number[];
    sourceImportId?: number;
    bindPersonalizedCopy?: boolean;
    now: Date;
  },
): Promise<ExactPoolAllocationResult> {
  await acquireEnrollmentCapacityLock(db);
  const campaignIds = input.requests.map((request) => request.campaignId);
  if (new Set(campaignIds).size !== campaignIds.length) {
    throw new PoolAllocationError('each target campaign may appear only once');
  }
  const remaining = input.candidateLeadIds.filter((id, index, all) => all.indexOf(id) === index);
  const used = new Set<number>();
  const exclusions: Record<string, number> = {};
  const results: ExactPoolAllocationResult['byCampaign'] = [];

  for (const request of input.requests) {
    const campaign = await lockCampaignForImport(db, request.campaignId);
    if (!campaign) throw new PoolAllocationError(`campaign ${request.campaignId} not found`);
    if (
      campaign.status !== 'draft' &&
      campaign.status !== 'paused' &&
      !(campaign.status === 'active' && !campaign.autoEnrollEnabled)
    ) {
      throw new PoolAllocationError(
        `${campaign.name} must be draft, paused, or active with automatic enrollment off to import into its pool`,
      );
    }
    const pinned =
      request.campaignId === input.draftCampaignId
        ? [...new Set(input.draftLeadIds ?? [])].filter((id) => !used.has(id))
        : [];
    if (pinned.length > request.count) {
      throw new PoolAllocationError(
        `${campaign.name} needs at least ${pinned.length} pooled leads for its imported drafts`,
      );
    }
    const ordered = [...pinned, ...remaining.filter((id) => !used.has(id) && !pinned.includes(id))];
    const checked = await poolEligibility(db, sequences, request.campaignId, ordered, input.now);
    for (const reason of checked.reasons.values()) {
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    }
    const eligibleIds = new Set(checked.eligible.map((lead) => lead.id));
    const invalidPinned = pinned.filter((id) => !eligibleIds.has(id));
    if (invalidPinned.length > 0) {
      throw new PoolAllocationError(
        `${invalidPinned.length} imported-draft lead(s) are no longer safe for ${campaign.name}`,
      );
    }
    const selected = ordered.filter((id) => eligibleIds.has(id)).slice(0, request.count);
    if (selected.length !== request.count) {
      throw new PoolAllocationError(
        `${campaign.name} requested ${request.count}, but only ${selected.length} safe leads remain`,
      );
    }
    await allocatePoolLeads(db, {
      campaignId: request.campaignId,
      leadIds: selected,
      sourceImportId: input.sourceImportId,
      now: input.now,
    });
    if (input.bindPersonalizedCopy !== false) {
      await bindSourcesOnAssignment(db, sequences, request.campaignId, selected, input.now);
    }
    await setCampaignPoolMode(db, request.campaignId);
    selected.forEach((id) => used.add(id));
    results.push({
      campaignId: request.campaignId,
      requested: request.count,
      allocated: selected.length,
      draftReserved: selected.filter((id) => pinned.includes(id)).length,
      leadIds: selected,
    });
  }
  return { byCampaign: results, allocatedLeadIds: [...used], exclusions };
}

export async function addNextGlobalPoolLeads(
  db: DbLike,
  sequences: SequenceProvider,
  input: { campaignId: number; count: number; sourceImportId?: number; now: Date },
): Promise<{ changed: number; skipped: Array<{ reason: string; count: number }> }> {
  await acquireEnrollmentCapacityLock(db);
  const campaign = await getCampaign(db, input.campaignId);
  if (!campaign || (campaign.status !== 'draft' && campaign.status !== 'paused')) {
    throw new PoolAllocationError('campaign must be draft or paused to change its pool');
  }
  const selected: number[] = [];
  const counts = new Map<string, number>();
  const pageSize = 500;
  let offset = 0;
  while (selected.length < input.count) {
    const candidates = await poolAllocationCandidates(db, pageSize, input.sourceImportId, offset);
    if (candidates.length === 0) break;
    const checked = await poolEligibility(
      db,
      sequences,
      input.campaignId,
      candidates.map((candidate) => candidate.id),
      input.now,
    );
    for (const reason of checked.reasons.values()) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    selected.push(
      ...checked.eligible.slice(0, input.count - selected.length).map((lead) => lead.id),
    );
    offset += candidates.length;
  }
  if (selected.length < input.count) {
    throw new PoolAllocationError(
      `requested ${input.count}, but only ${selected.length} safe global leads are available`,
    );
  }
  await allocatePoolLeads(db, { ...input, leadIds: selected });
  await bindSourcesOnAssignment(db, sequences, input.campaignId, selected, input.now);
  await setCampaignPoolMode(db, input.campaignId);
  return {
    changed: selected.length,
    skipped: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}

export async function releaseFromPool(
  db: DbLike,
  input: { campaignId: number; leadIds: readonly number[]; now: Date },
): Promise<number> {
  await acquireEnrollmentCapacityLock(db);
  const campaign = await getCampaign(db, input.campaignId);
  if (!campaign || (campaign.status !== 'draft' && campaign.status !== 'paused')) {
    throw new PoolAllocationError('campaign must be draft or paused to change its pool');
  }
  return releasePoolLeads(db, input.campaignId, input.leadIds, input.now);
}

export async function reassignPoolLeads(
  db: DbLike,
  sequences: SequenceProvider,
  input: {
    sourceCampaignId: number;
    targetCampaignId: number;
    leadIds: readonly number[];
    now: Date;
  },
): Promise<number> {
  await acquireEnrollmentCapacityLock(db);
  if (input.sourceCampaignId === input.targetCampaignId) {
    throw new PoolAllocationError('source and target campaigns must differ');
  }
  const source = await getCampaign(db, input.sourceCampaignId);
  const target = await getCampaign(db, input.targetCampaignId);
  if (!source || !target) throw new PoolAllocationError('campaign not found');
  if (
    !['draft', 'paused'].includes(source.status) ||
    !['draft', 'paused'].includes(target.status)
  ) {
    throw new PoolAllocationError('both campaigns must be draft or paused');
  }
  const available = await availablePoolLeadIds(db, input.sourceCampaignId, input.leadIds);
  if (available.length !== new Set(input.leadIds).size) {
    throw new PoolAllocationError('one or more selected leads are no longer available to reassign');
  }
  // Release inside the caller's transaction before checking the target so the
  // source reservation does not make an otherwise-safe lead look reserved
  // elsewhere. Any failed target check rolls this release back atomically.
  await releasePoolLeads(db, input.sourceCampaignId, available, input.now);
  const checked = await poolEligibility(
    db,
    sequences,
    input.targetCampaignId,
    available,
    input.now,
  );
  if (checked.eligible.length !== available.length) {
    throw new PoolAllocationError(
      'one or more selected leads are not eligible for the target campaign',
    );
  }
  await allocatePoolLeads(db, {
    campaignId: input.targetCampaignId,
    leadIds: available,
    now: input.now,
  });
  await bindSourcesOnAssignment(db, sequences, input.targetCampaignId, available, input.now);
  await setCampaignPoolMode(db, input.targetCampaignId);
  return available.length;
}
