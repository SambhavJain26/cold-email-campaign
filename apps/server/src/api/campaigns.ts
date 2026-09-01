// Campaign route group (B6.6, docs/10 §Campaigns). Enroll/recycle wrap the
// B3.9/B5.7 services — capacity gate, recycle hash guard, nurture rules all
// live there; this layer only maps shapes and typed errors.
import type { FastifyInstance } from 'fastify';
import {
  campaignSchema,
  campaignsListResponseSchema,
  capacityResponseSchema,
  campaignPoolQuerySchema,
  campaignPoolResponseSchema,
  poolAddBodySchema,
  poolLeadIdsBodySchema,
  poolMutationResponseSchema,
  poolReassignBodySchema,
  patchAutoEnrollmentBodySchema,
  patchAutoEnrollmentResponseSchema,
  autoEnrollmentRunsQuerySchema,
  autoEnrollmentRunsResponseSchema,
  coldStorageQuerySchema,
  coldStorageResponseSchema,
  createCampaignBodySchema,
  deleteCampaignBodySchema,
  enrollBodySchema,
  enrollResponseSchema,
  idParamSchema,
  outcomesResponseSchema,
  okResponseSchema,
  pageQuerySchema,
  patchCampaignBodySchema,
  recycleBodySchema,
  recycleCommitResponseSchema,
  recyclePreviewBodySchema,
  recyclePreviewResponseSchema,
  type CampaignDto,
  personalizedCopyCoverageResponseSchema,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import {
  campaignCounts,
  createCampaign,
  deleteCampaignIfUnreferenced,
  getCampaign,
  listCampaigns,
  outcomeCounts,
  patchCampaign,
  rampOf,
  rampStagesOf,
  resolvedVariablesOf,
  tierEffortOf,
  autoObservationConfigOf,
  variableOverridesOf,
  type CampaignCounts,
  type CampaignRow,
} from '../db/repos/campaignsRepo';
import { recycleSourcesByTargetIds, type RecycleSourceSummary } from '../db/repos/recyclingRepo';
import { getSequenceNested } from '../db/repos/sequencesRepo';
import {
  capacityToday,
  coldStorage,
  enroll,
  enrollByIds,
  type EnrollResult,
} from '../services/enrollment';
import {
  commitRecycle,
  previewRecycle,
  RecycleValidationError,
  type RecycleBreakdown,
  type RecycleSourceContribution,
} from '../services/recycling';
import { getSettings } from '../db/repos/settingsRepo';
import { checkRamp, checkRampStages } from '../services/guardrails';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';
import {
  listCampaignPool,
  poolSummary,
  type CampaignPoolSummary,
} from '../db/repos/campaignPoolRepo';
import {
  lastAutoEnrollmentRunsByCampaign,
  listAutoEnrollmentRuns,
  type AutoEnrollmentRunRow,
} from '../db/repos/autoEnrollmentRepo';
import {
  addNextGlobalPoolLeads,
  PoolAllocationError,
  reassignPoolLeads,
  releaseFromPool,
} from '../services/campaignPools';
import { personalizedCopyCoverage } from '../db/repos/manualDraftsRepo';

function toCampaignDto(
  row: CampaignRow,
  counts: CampaignCounts,
  recycleSources: RecycleSourceSummary[] = [],
  pool: CampaignPoolSummary = {
    total: 0,
    available: 0,
    enrolled: 0,
    released: 0,
    temporarilyIneligible: 0,
    sourceImports: 0,
  },
  lastRun: (AutoEnrollmentRunRow & { enrolled: number }) | null = null,
): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    sequence_id: row.sequenceId,
    tier_effort_config: tierEffortOf(row),
    ramp_config: rampOf(row),
    ramp_stages: rampStagesOf(row),
    first_activated_at: row.firstActivatedAt?.toISOString() ?? null,
    variable_overrides: variableOverridesOf(row),
    resolved_variables: resolvedVariablesOf(row),
    auto_observation: autoObservationConfigOf(row),
    lead_selection_mode: row.leadSelectionMode,
    auto_enroll_enabled: row.autoEnrollEnabled,
    steady_daily_enroll_cap: row.steadyDailyEnrollCap,
    pool_summary: {
      total: pool.total,
      available: pool.available,
      enrolled: pool.enrolled,
      released: pool.released,
      temporarily_ineligible: pool.temporarilyIneligible,
      source_imports: pool.sourceImports,
    },
    last_auto_enrollment_run: lastRun ? toAutoRunDto(lastRun) : null,
    recycle_sources: recycleSources.map((source) => ({
      campaign_id: source.campaignId,
      name: source.name,
      contributed_leads: source.contributedLeads,
    })),
    recycled_from_campaign_id: recycleSources.length === 1 ? recycleSources[0]!.campaignId : null,
    enrolled_count: counts.enrolledCount,
    contacted_count: counts.contactedCount,
    delivery_confirmed_count: counts.deliveryConfirmedCount,
    pending_delivery_confirmation_count: counts.pendingDeliveryConfirmationCount,
    finished_count: counts.finishedCount,
    finishing_count: counts.finishingCount,
    manual_only_count: counts.manualOnlyCount,
  };
}

function toAutoRunDto(row: AutoEnrollmentRunRow & { enrolled: number }) {
  return {
    id: row.id,
    trigger: row.trigger,
    local_date: row.localDate,
    status: row.status,
    enrolled: row.enrolled,
    started_at: row.startedAt.toISOString(),
    completed_at: row.completedAt?.toISOString() ?? null,
    error: row.error,
  };
}

function toRecyclePreview(breakdown: RecycleBreakdown, sources: RecycleSourceContribution[]) {
  return {
    breakdown: {
      unique_leads: breakdown.uniqueLeads,
      duplicates: breakdown.duplicates,
      rest_period_failures: breakdown.restPeriodFailures,
      nurture_exclusions: breakdown.nurtureExclusions,
      untiered_exclusions: breakdown.untieredExclusions,
      personalized_copy_blocks: breakdown.personalizedCopyBlocks,
      suppression_recontact_blocks: breakdown.suppressionRecontactBlocks,
      existing_target_enrollments: breakdown.existingTargetEnrollments,
      prior_content_conflicts: breakdown.priorContentConflicts,
      eligible: breakdown.eligible,
    },
    sources: sources.map((source) => ({
      source_campaign_id: source.sourceCampaignId,
      name: source.name,
      candidates: source.candidates,
      eligible: source.eligible,
    })),
  };
}

function toEnrollResponse(r: EnrollResult) {
  return { enrolled: r.enrolled, skipped: r.skipped };
}

export async function campaignsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, store, sequences } = services;
  const enrollDeps = { db, store, clock, sequences };

  r.get(
    '/campaigns/:id/personalized-copy-coverage',
    {
      schema: {
        params: idParamSchema,
        response: { 200: personalizedCopyCoverageResponseSchema },
      },
    },
    async (req) => {
      if (!(await getCampaign(db, req.params.id))) throw AppError.notFound('campaign');
      const coverage = await personalizedCopyCoverage(db, req.params.id);
      return {
        blocked_count: coverage.blockedCount,
        steps: coverage.steps.map((step) => ({
          step_no: step.stepNo,
          ready: step.ready,
          needs_review: step.needsReview,
          missing: step.missing,
          blocked: step.blocked,
          total: step.total,
        })),
      };
    },
  );

  const validateDraftConfiguration = async (
    campaign: CampaignRow,
    patch: {
      tierEffortConfig?: ReturnType<typeof tierEffortOf>;
      rampStages?: ReturnType<typeof rampStagesOf>;
      autoObservation?: ReturnType<typeof autoObservationConfigOf>;
    } = {},
  ) => {
    const settings = await getSettings(db);
    const rampViolation = checkRampStages(patch.rampStages ?? rampStagesOf(campaign), {
      maxMailboxDailyCap: settings.maxMailboxDailyCap,
      maxRampDailyEnrollCap: settings.maxRampDailyEnrollCap,
      minRampDays: settings.minRampDays,
    });
    if (rampViolation) throw new AppError('validation', 422, rampViolation);

    const effort = patch.tierEffortConfig ?? tierEffortOf(campaign);
    const auto = patch.autoObservation ?? autoObservationConfigOf(campaign);
    const nested = campaign.sequenceId ? await getSequenceNested(db, campaign.sequenceId) : null;
    const usesAutoSlot =
      Object.values(effort).includes('template_auto') &&
      nested?.steps.some(({ variants }) =>
        variants.some(
          (variant) =>
            variant.subjectTemplate.includes('{{custom_observation') ||
            variant.bodyTemplate.includes('{{custom_observation'),
        ),
      );
    if (usesAutoSlot) {
      if (!auto.field?.trim()) {
        throw new AppError('validation', 422, 'Auto Slot requires a segmentation field');
      }
      const entries = Object.entries(auto.rules);
      if (!Object.hasOwn(auto.rules, 'default') || auto.rules.default?.trim() === '') {
        throw new AppError('validation', 422, 'Auto Slot requires a non-empty default observation');
      }
      const keys = entries.map(([key]) => key.trim().toLocaleLowerCase());
      if (new Set(keys).size !== keys.length || entries.some(([, value]) => value.trim() === '')) {
        throw new AppError(
          'validation',
          422,
          'Auto Observation keys must be unique and values non-empty',
        );
      }
    }
  };

  const requireCampaign = async (id: number): Promise<CampaignRow> => {
    const row = await getCampaign(db, id);
    if (!row) throw AppError.notFound('campaign');
    return row;
  };

  r.get(
    '/campaigns',
    { schema: { querystring: pageQuerySchema, response: { 200: campaignsListResponseSchema } } },
    async (req) => {
      const { page, per_page } = req.query;
      const { items, total } = await listCampaigns(db, page, per_page);
      const sources = await recycleSourcesByTargetIds(
        db,
        items.map((item) => item.campaign.id),
      );
      const lastRuns = await lastAutoEnrollmentRunsByCampaign(
        db,
        items.map((item) => item.campaign.id),
      );
      return {
        items: await Promise.all(
          items.map(async (i) =>
            toCampaignDto(
              i.campaign,
              i.counts,
              sources.get(i.campaign.id) ?? [],
              await poolSummary(db, i.campaign.id),
              lastRuns.get(i.campaign.id) ?? null,
            ),
          ),
        ),
        total,
        page,
        per_page,
      };
    },
  );

  r.post(
    '/campaigns',
    { schema: { body: createCampaignBodySchema, response: { 200: campaignSchema } } },
    async (req) => {
      if (!(await getSequenceNested(db, req.body.sequence_id))) {
        throw AppError.notFound('sequence');
      }
      // Launch guardrail (0011). Ramp is create-only (docs/12 §6(d)), so this
      // is the single point where an unsafe ramp could enter the system.
      const s = await getSettings(db);
      const violation = checkRamp(req.body.ramp_config, {
        maxMailboxDailyCap: s.maxMailboxDailyCap,
        maxRampDailyEnrollCap: s.maxRampDailyEnrollCap,
        minRampDays: s.minRampDays,
      });
      if (violation) throw new AppError('validation', 422, violation);
      const stageViolation = checkRampStages(req.body.ramp_stages, {
        maxMailboxDailyCap: s.maxMailboxDailyCap,
        maxRampDailyEnrollCap: s.maxRampDailyEnrollCap,
        minRampDays: s.minRampDays,
      });
      if (stageViolation) throw new AppError('validation', 422, stageViolation);
      const steadyCap = req.body.steady_daily_enroll_cap ?? req.body.ramp_stages.at(-1)?.cap ?? 15;
      if (steadyCap > s.maxRampDailyEnrollCap) {
        throw new AppError(
          'validation',
          422,
          `steady daily enrollment cap ${steadyCap} exceeds the launch guardrail of ${s.maxRampDailyEnrollCap}`,
        );
      }
      if (req.body.auto_enroll_enabled === true) {
        throw new AppError(
          'validation',
          422,
          'create the campaign pool before enabling automatic enrollment',
        );
      }

      const row = await createCampaign(db, {
        name: req.body.name,
        sequenceId: req.body.sequence_id,
        tierEffortConfig: {
          A: 'template_researched',
          B: 'template_auto',
          C: 'template_auto',
        },
        rampConfig: req.body.ramp_config,
        rampStages: req.body.ramp_stages,
        variableOverrides: req.body.variable_overrides,
        autoObservation: req.body.auto_observation,
        steadyDailyEnrollCap: steadyCap,
        autoEnrollEnabled: false,
      });
      return toCampaignDto(
        row,
        {
          enrolledCount: 0,
          contactedCount: 0,
          deliveryConfirmedCount: 0,
          pendingDeliveryConfirmationCount: 0,
          finishedCount: 0,
          finishingCount: 0,
          manualOnlyCount: 0,
        },
        [],
        await poolSummary(db, row.id),
      );
    },
  );

  r.patch(
    '/campaigns/:id',
    {
      schema: {
        params: idParamSchema,
        body: patchCampaignBodySchema,
        response: { 200: campaignSchema },
      },
    },
    async (req) => {
      const existing = await requireCampaign(req.params.id);
      const changesConfiguration =
        req.body.ramp_stages !== undefined ||
        req.body.variable_overrides !== undefined ||
        req.body.auto_observation !== undefined;
      if (changesConfiguration && existing.status !== 'draft') {
        throw new AppError(
          'conflict',
          409,
          'campaign personalization and ramp configuration is frozen after first activation',
        );
      }
      if (changesConfiguration || (existing.status === 'draft' && req.body.status === 'active')) {
        await validateDraftConfiguration(existing, {
          rampStages: req.body.ramp_stages,
          autoObservation: req.body.auto_observation,
        });
      }
      if (req.body.steady_daily_enroll_cap !== undefined) {
        const settings = await getSettings(db);
        if (req.body.steady_daily_enroll_cap > settings.maxRampDailyEnrollCap) {
          throw new AppError(
            'validation',
            422,
            'steady daily enrollment cap exceeds the global guardrail',
          );
        }
        if (
          existing.firstActivatedAt !== null &&
          req.body.steady_daily_enroll_cap > existing.steadyDailyEnrollCap
        ) {
          throw new AppError(
            'conflict',
            409,
            'steady daily enrollment cap can only be lowered after first activation',
          );
        }
      }
      const row = await patchCampaign(db, req.params.id, {
        name: req.body.name,
        status: req.body.status,
        rampStages: req.body.ramp_stages,
        variableOverrides: req.body.variable_overrides,
        autoObservation: req.body.auto_observation,
        firstActivatedAt:
          existing.firstActivatedAt === null && req.body.status === 'active'
            ? clock.now()
            : undefined,
        steadyDailyEnrollCap: req.body.steady_daily_enroll_cap,
      });
      if (
        row!.status === 'active' &&
        row!.autoEnrollEnabled &&
        req.body.status === 'active' &&
        existing.status !== 'active'
      ) {
        await services.autoEnrollment.run(
          existing.firstActivatedAt === null ? 'activation' : 'resume',
          [row!.id],
        );
      }
      const sources = (await recycleSourcesByTargetIds(db, [req.params.id])).get(req.params.id);
      const lastRun = (await lastAutoEnrollmentRunsByCampaign(db, [req.params.id])).get(
        req.params.id,
      );
      return toCampaignDto(
        row!,
        await campaignCounts(db, req.params.id),
        sources ?? [],
        await poolSummary(db, req.params.id),
        lastRun ?? null,
      );
    },
  );

  r.delete(
    '/campaigns/:id',
    {
      schema: {
        params: idParamSchema,
        body: deleteCampaignBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const campaign = await requireCampaign(req.params.id);
      if (req.body.confirm.trim() !== campaign.name) {
        throw new AppError('validation', 400, 'confirm must equal the campaign name');
      }
      const result = await deleteCampaignIfUnreferenced(db, campaign.id);
      if (!result.deleted) {
        throw new AppError('conflict', 409, result.reason ?? 'campaign cannot be deleted');
      }
      return { ok: true } as const;
    },
  );

  r.get(
    '/campaigns/:id/capacity',
    { schema: { params: idParamSchema, response: { 200: capacityResponseSchema } } },
    async (req) => {
      await requireCampaign(req.params.id);
      const cap = await capacityToday(enrollDeps, req.params.id);
      return {
        total_daily_capacity: cap.total,
        followups_due_today: cap.followupsDue,
        pending_openers_today: cap.pendingOpeners,
        sent_so_far_today: cap.sentSoFar,
        room_for_new: cap.roomForNew,
        ramp_cap_remaining: cap.rampCap,
        ramp_day: cap.rampDay,
        ramp_stage: cap.rampStage,
        effective_daily_enroll_cap: cap.effectiveDailyCap,
        campaign_cap_remaining: cap.campaignCapRemaining,
        pool_available: cap.poolAvailable,
        enrolled_today: cap.enrolledToday,
        suggested: cap.suggested,
      };
    },
  );

  r.get(
    '/campaigns/:id/pool',
    {
      schema: {
        params: idParamSchema,
        querystring: campaignPoolQuerySchema,
        response: { 200: campaignPoolResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      const result = await listCampaignPool(
        db,
        req.params.id,
        req.query.page,
        req.query.per_page,
        req.query.status,
      );
      const summary = await poolSummary(db, req.params.id);
      return {
        items: result.items.map((item) => ({
          id: item.id,
          campaign_id: item.campaignId,
          lead: {
            id: item.leadId,
            email: item.email,
            first_name: item.firstName,
            last_name: item.lastName,
            company: item.company,
            tier: item.tier,
          },
          source_import_id: item.sourceImportId,
          allocation_order: item.allocationOrder,
          status: item.status,
          enrollment_id: item.enrollmentId,
          last_eligibility_reason: item.lastEligibilityReason,
          allocated_at: item.allocatedAt.toISOString(),
          enrolled_at: item.enrolledAt?.toISOString() ?? null,
          released_at: item.releasedAt?.toISOString() ?? null,
        })),
        total: result.total,
        page: req.query.page,
        per_page: req.query.per_page,
        summary: {
          total: summary.total,
          available: summary.available,
          enrolled: summary.enrolled,
          released: summary.released,
          temporarily_ineligible: summary.temporarilyIneligible,
          source_imports: summary.sourceImports,
        },
      };
    },
  );

  r.post(
    '/campaigns/:id/pool/add',
    {
      schema: {
        params: idParamSchema,
        body: poolAddBodySchema,
        response: { 200: poolMutationResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      try {
        return await db.transaction(
          (tx) =>
            addNextGlobalPoolLeads(tx, sequences, {
              campaignId: req.params.id,
              count: req.body.count,
              sourceImportId: req.body.source_import_id,
              now: clock.now(),
            }),
          { isolationLevel: 'serializable' },
        );
      } catch (error) {
        if (error instanceof PoolAllocationError)
          throw new AppError('conflict', 409, error.message);
        throw error;
      }
    },
  );

  r.post(
    '/campaigns/:id/pool/release',
    {
      schema: {
        params: idParamSchema,
        body: poolLeadIdsBodySchema,
        response: { 200: poolMutationResponseSchema },
      },
    },
    async (req) => {
      try {
        const changed = await db.transaction((tx) =>
          releaseFromPool(tx, {
            campaignId: req.params.id,
            leadIds: req.body.lead_ids,
            now: clock.now(),
          }),
        );
        return { changed, skipped: [] };
      } catch (error) {
        if (error instanceof PoolAllocationError)
          throw new AppError('conflict', 409, error.message);
        throw error;
      }
    },
  );

  r.post(
    '/campaigns/:id/pool/reassign',
    {
      schema: {
        params: idParamSchema,
        body: poolReassignBodySchema,
        response: { 200: poolMutationResponseSchema },
      },
    },
    async (req) => {
      try {
        const changed = await db.transaction(
          (tx) =>
            reassignPoolLeads(tx, sequences, {
              sourceCampaignId: req.params.id,
              targetCampaignId: req.body.target_campaign_id,
              leadIds: req.body.lead_ids,
              now: clock.now(),
            }),
          { isolationLevel: 'serializable' },
        );
        return { changed, skipped: [] };
      } catch (error) {
        if (error instanceof PoolAllocationError)
          throw new AppError('conflict', 409, error.message);
        throw error;
      }
    },
  );

  r.patch(
    '/campaigns/:id/auto-enrollment',
    {
      schema: {
        params: idParamSchema,
        body: patchAutoEnrollmentBodySchema,
        response: { 200: patchAutoEnrollmentResponseSchema },
      },
    },
    async (req) => {
      const campaign = await requireCampaign(req.params.id);
      if (req.body.enabled && req.body.acknowledge_auto_enrollment !== true) {
        throw new AppError(
          'validation',
          422,
          'acknowledge automatic enrollment before enabling it',
        );
      }
      const summary = await poolSummary(db, campaign.id);
      if (req.body.enabled && (campaign.leadSelectionMode !== 'pool' || summary.available === 0)) {
        throw new AppError(
          'conflict',
          409,
          'automatic enrollment requires an available campaign pool',
        );
      }
      const row = await patchCampaign(db, campaign.id, { autoEnrollEnabled: req.body.enabled });
      if (req.body.enabled && row!.status === 'active') {
        await services.autoEnrollment.run('enabled', [row!.id]);
      }
      const sources = (await recycleSourcesByTargetIds(db, [campaign.id])).get(campaign.id) ?? [];
      const lastRun = (await lastAutoEnrollmentRunsByCampaign(db, [campaign.id])).get(campaign.id);
      return {
        campaign: toCampaignDto(
          row!,
          await campaignCounts(db, campaign.id),
          sources,
          await poolSummary(db, campaign.id),
          lastRun ?? null,
        ),
        run: lastRun ? toAutoRunDto(lastRun) : null,
      };
    },
  );

  r.get(
    '/campaigns/:id/auto-enrollment/runs',
    {
      schema: {
        params: idParamSchema,
        querystring: autoEnrollmentRunsQuerySchema,
        response: { 200: autoEnrollmentRunsResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      const result = await listAutoEnrollmentRuns(
        db,
        req.params.id,
        req.query.page,
        req.query.per_page,
      );
      return {
        items: result.items.map(toAutoRunDto),
        total: result.total,
        page: req.query.page,
        per_page: req.query.per_page,
      };
    },
  );

  r.post(
    '/campaigns/:id/enroll',
    {
      schema: {
        params: idParamSchema,
        body: enrollBodySchema,
        response: { 200: enrollResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      const result =
        'count' in req.body
          ? await enroll(enrollDeps, req.params.id, req.body.count)
          : await enrollByIds(enrollDeps, req.params.id, req.body.lead_ids, {
              force: req.body.force,
              allowRecontact: req.body.allow_recontact,
            });
      return toEnrollResponse(result);
    },
  );

  r.get(
    '/campaigns/:id/outcomes',
    { schema: { params: idParamSchema, response: { 200: outcomesResponseSchema } } },
    async (req) => {
      await requireCampaign(req.params.id);
      const rows = await outcomeCounts(db, req.params.id);
      const count = (state: string, sentiment?: string) =>
        rows
          .filter(
            (x) => x.state === state && (sentiment === undefined || x.sentiment === sentiment),
          )
          .reduce((a, x) => a + x.n, 0);
      const replied = count('REPLIED');
      const repliedPositive = count('REPLIED', 'positive');
      return {
        UNSUBSCRIBED: count('UNSUBSCRIBED'),
        BOUNCED: count('BOUNCED'),
        // The public "neutral" bucket is the UI's "neutral/negative"
        // remainder. Untagged replies are terminal replies too and must not
        // disappear from the mutually-exclusive outcome sum.
        REPLIED: { positive: repliedPositive, neutral: replied - repliedPositive },
        COMPLETED: count('COMPLETED'),
        ACTIVE: count('ACTIVE'),
        NEW: count('NEW'),
        total: rows.reduce((a, x) => a + x.n, 0),
      };
    },
  );

  r.post(
    '/campaigns/:id/recycle/preview',
    {
      schema: {
        params: idParamSchema,
        body: recyclePreviewBodySchema,
        response: { 200: recyclePreviewResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      try {
        const result = await previewRecycle(
          { db, clock },
          req.params.id,
          req.body.source_campaign_ids,
        );
        return toRecyclePreview(result.breakdown, result.sources);
      } catch (error) {
        if (error instanceof RecycleValidationError) {
          throw new AppError('conflict', 409, error.message);
        }
        throw error;
      }
    },
  );

  r.post(
    '/campaigns/:id/recycle',
    {
      schema: {
        params: idParamSchema,
        body: recycleBodySchema,
        response: { 200: recycleCommitResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      const sourceIds =
        'source_campaign_ids' in req.body
          ? req.body.source_campaign_ids
          : [req.body.source_campaign_id];
      try {
        const result = await commitRecycle({ db, store, clock }, req.params.id, sourceIds);
        return {
          ...toRecyclePreview(result.breakdown, result.sources),
          enrolled: result.enrolled,
          skipped: result.skipped,
        };
      } catch (error) {
        if (error instanceof RecycleValidationError) {
          throw new AppError('conflict', 409, error.message);
        }
        throw error;
      }
    },
  );

  r.get(
    '/cold-storage',
    {
      schema: {
        querystring: coldStorageQuerySchema,
        response: { 200: coldStorageResponseSchema },
      },
    },
    async (req) => {
      if (!(await getCampaign(db, req.query.source_campaign_id))) {
        throw AppError.notFound('campaign');
      }
      const allItems = await coldStorage({ db, clock }, req.query.source_campaign_id);
      const start = (req.query.page - 1) * req.query.per_page;
      const items = allItems.slice(start, start + req.query.per_page);
      return {
        items: items.map((i) => ({
          lead: { id: i.leadId, email: i.email, tier: i.tier },
          completed_at: i.completedAt.toISOString(),
          earliest_recycle_at: i.earliestRecycleAt.toISOString(),
          eligible: i.eligible,
        })),
        total: allItems.length,
        page: req.query.page,
        per_page: req.query.per_page,
      };
    },
  );
}
