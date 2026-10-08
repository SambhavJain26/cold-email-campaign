// Campaign endpoints (docs/10 §Campaigns): CRUD, the capacity meter,
// enroll/recycle (dual body shapes), the Stage-9 outcomes panel, cold storage.
import { z } from 'zod';
import { CAMPAIGN_STATUSES, LEAD_TIERS, PERSONALIZATION_MODES } from '../domain/index';
import { isoDateTime, listOf, pageQuerySchema } from './common';
import { sequenceVariablesSchema } from './sequences';

export const tierEffortConfigSchema = z
  .object({
    A: z.enum(PERSONALIZATION_MODES),
    B: z.enum(PERSONALIZATION_MODES),
    C: z.enum(PERSONALIZATION_MODES),
    auto_observations: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const rampConfigSchema = z
  .object({
    ramp_days: z.number().int().min(0),
    ramp_daily_enroll_cap: z.number().int().min(0),
  })
  .strict();

export const rampStageSchema = z
  .object({
    start_day: z.number().int().min(1),
    end_day: z.number().int().min(1),
    cap: z.number().int().min(0),
  })
  .strict();

export const DEFAULT_RAMP_STAGES = [
  { start_day: 1, end_day: 1, cap: 5 },
  { start_day: 2, end_day: 2, cap: 8 },
  { start_day: 3, end_day: 3, cap: 10 },
  { start_day: 4, end_day: 4, cap: 12 },
  { start_day: 5, end_day: 7, cap: 15 },
] as const;

export const rampStagesSchema = z.array(rampStageSchema).superRefine((stages, ctx) => {
  const sorted = [...stages].sort((a, b) => a.start_day - b.start_day);
  for (let i = 0; i < sorted.length; i++) {
    const stage = sorted[i]!;
    const expected = i === 0 ? 1 : sorted[i - 1]!.end_day + 1;
    if (stage.end_day < stage.start_day || stage.start_day !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ramp stages must cover every day from 1 with no overlaps or gaps',
      });
      break;
    }
  }
});

export const autoObservationConfigSchema = z
  .object({
    field: z.string().min(1).nullable(),
    rules: z.record(z.string(), z.string()),
  })
  .strict();

export const campaignRecycleSourceSchema = z
  .object({
    campaign_id: z.number().int(),
    name: z.string(),
    contributed_leads: z.number().int().min(0),
  })
  .strict();

export const leadSelectionModeSchema = z.enum(['global', 'pool']);

export const campaignPoolSummarySchema = z
  .object({
    total: z.number().int().min(0),
    available: z.number().int().min(0),
    enrolled: z.number().int().min(0),
    released: z.number().int().min(0),
    temporarily_ineligible: z.number().int().min(0),
    source_imports: z.number().int().min(0),
  })
  .strict();

export const autoEnrollmentRunSummarySchema = z
  .object({
    id: z.number().int(),
    trigger: z.enum(['daily', 'enabled', 'activation', 'resume']),
    local_date: z.string(),
    status: z.enum(['running', 'completed', 'failed']),
    enrolled: z.number().int().min(0),
    started_at: isoDateTime,
    completed_at: isoDateTime.nullable(),
    error: z.string().nullable(),
  })
  .strict();

export const campaignSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    status: z.enum(CAMPAIGN_STATUSES),
    sequence_id: z.number().int().nullable(),
    tier_effort_config: tierEffortConfigSchema,
    ramp_config: rampConfigSchema,
    ramp_stages: rampStagesSchema,
    first_activated_at: isoDateTime.nullable(),
    variable_overrides: sequenceVariablesSchema,
    resolved_variables: sequenceVariablesSchema,
    auto_observation: autoObservationConfigSchema,
    lead_selection_mode: leadSelectionModeSchema,
    auto_enroll_enabled: z.boolean(),
    steady_daily_enroll_cap: z.number().int().positive(),
    pool_summary: campaignPoolSummarySchema,
    last_auto_enrollment_run: autoEnrollmentRunSummarySchema.nullable(),
    recycle_sources: z.array(campaignRecycleSourceSchema),
    recycled_from_campaign_id: z.number().int().nullable(),
    enrolled_count: z.number().int().min(0),
    contacted_count: z.number().int().min(0),
    delivery_confirmed_count: z.number().int().min(0),
    pending_delivery_confirmation_count: z.number().int().min(0),
    finished_count: z.number().int().min(0),
    finishing_count: z.number().int().min(0),
    manual_only_count: z.number().int().min(0),
  })
  .strict();
export type CampaignDto = z.infer<typeof campaignSchema>;

export const campaignsListResponseSchema = listOf(campaignSchema);

export const personalizedCopyCoverageResponseSchema = z
  .object({
    blocked_count: z.number().int().min(0),
    steps: z.array(
      z
        .object({
          step_no: z.number().int().positive(),
          ready: z.number().int().min(0),
          needs_review: z.number().int().min(0),
          missing: z.number().int().min(0),
          blocked: z.number().int().min(0),
          total: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();

export const createCampaignBodySchema = z
  .object({
    name: z.string().min(1),
    sequence_id: z.number().int().positive(),
    /** Deprecated compatibility input. The server always stores fixed A=researched/B=auto. */
    tier_effort_config: tierEffortConfigSchema.optional(),
    ramp_config: rampConfigSchema.optional(),
    ramp_stages: rampStagesSchema.default(DEFAULT_RAMP_STAGES.map((stage) => ({ ...stage }))),
    variable_overrides: sequenceVariablesSchema.optional(),
    auto_observation: autoObservationConfigSchema.optional(),
    steady_daily_enroll_cap: z.number().int().positive().optional(),
    auto_enroll_enabled: z.boolean().optional(),
    /** Deprecated no-op retained for older clients during the sequence-only transition. */
    acknowledge_tier_a_manual: z.boolean().optional(),
  })
  .strict();
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

export const patchCampaignBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    ramp_stages: rampStagesSchema.optional(),
    variable_overrides: sequenceVariablesSchema.optional(),
    auto_observation: autoObservationConfigSchema.optional(),
    steady_daily_enroll_cap: z.number().int().positive().optional(),
  })
  .strict();
export type PatchCampaignBody = z.infer<typeof patchCampaignBodySchema>;

/** Typed confirmation for irreversible metadata deletion. */
export const deleteCampaignBodySchema = z.object({ confirm: z.string().min(1) }).strict();

export const capacityResponseSchema = z
  .object({
    total_daily_capacity: z.number().int(),
    followups_due_today: z.number().int(),
    pending_openers_today: z.number().int(),
    sent_so_far_today: z.number().int(),
    room_for_new: z.number().int(),
    ramp_cap_remaining: z.number().int().nullable(),
    ramp_day: z.number().int().positive().nullable(),
    ramp_stage: rampStageSchema.nullable(),
    effective_daily_enroll_cap: z.number().int().positive(),
    campaign_cap_remaining: z.number().int().min(0),
    pool_available: z.number().int().min(0).nullable(),
    enrolled_today: z.number().int().min(0),
    suggested: z.number().int(),
  })
  .strict();

export type CapacityResponse = z.infer<typeof capacityResponseSchema>;

export const campaignPoolItemSchema = z
  .object({
    id: z.number().int(),
    campaign_id: z.number().int(),
    lead: z
      .object({
        id: z.number().int(),
        email: z.string(),
        first_name: z.string().nullable(),
        last_name: z.string().nullable(),
        company: z.string().nullable(),
        tier: z.enum(LEAD_TIERS).nullable(),
      })
      .strict(),
    source_import_id: z.number().int().nullable(),
    allocation_order: z.number().int(),
    status: z.enum(['available', 'enrolled', 'released']),
    enrollment_id: z.number().int().nullable(),
    last_eligibility_reason: z.string().nullable(),
    allocated_at: isoDateTime,
    enrolled_at: isoDateTime.nullable(),
    released_at: isoDateTime.nullable(),
  })
  .strict();
export type CampaignPoolItemDto = z.infer<typeof campaignPoolItemSchema>;

export const campaignPoolQuerySchema = pageQuerySchema.extend({
  status: z.enum(['available', 'enrolled', 'released']).optional(),
});

export const campaignPoolResponseSchema = listOf(campaignPoolItemSchema).extend({
  summary: campaignPoolSummarySchema,
});

export const poolAddBodySchema = z
  .object({
    count: z.number().int().positive(),
    source_import_id: z.number().int().positive().optional(),
  })
  .strict();
export const poolLeadIdsBodySchema = z
  .object({ lead_ids: z.array(z.number().int().positive()).min(1) })
  .strict();
export const poolReassignBodySchema = poolLeadIdsBodySchema.extend({
  target_campaign_id: z.number().int().positive(),
});
export const poolMutationResponseSchema = z
  .object({
    changed: z.number().int().min(0),
    skipped: z.array(z.object({ reason: z.string(), count: z.number().int().min(1) }).strict()),
  })
  .strict();

export const patchAutoEnrollmentBodySchema = z
  .object({ enabled: z.boolean(), acknowledge_auto_enrollment: z.boolean().optional() })
  .strict();
export const patchAutoEnrollmentResponseSchema = z
  .object({ campaign: campaignSchema, run: autoEnrollmentRunSummarySchema.nullable() })
  .strict();

export const autoEnrollmentRunsQuerySchema = pageQuerySchema;
export const autoEnrollmentRunsResponseSchema = listOf(autoEnrollmentRunSummarySchema);
export type AutoEnrollmentRunSummaryDto = z.infer<typeof autoEnrollmentRunSummarySchema>;

export const enrollBodySchema = z.union([
  z.object({ count: z.number().int().min(1) }).strict(),
  z
    .object({
      lead_ids: z.array(z.number().int().positive()).min(1),
      force: z.boolean().optional(),
      allow_recontact: z.boolean().optional(),
    })
    .strict(),
]);

export const enrollResponseSchema = z
  .object({
    enrolled: z.number().int().min(0),
    skipped: z.array(z.object({ reason: z.string(), count: z.number().int().min(1) }).strict()),
  })
  .strict();

export const outcomesResponseSchema = z
  .object({
    UNSUBSCRIBED: z.number().int(),
    BOUNCED: z.number().int(),
    REPLIED: z.object({ positive: z.number().int(), neutral: z.number().int() }).strict(),
    COMPLETED: z.number().int(),
    STOPPED: z.number().int().default(0),
    SUPPRESSED: z.number().int().optional(),
    ACTIVE: z.number().int(),
    NEW: z.number().int(),
    total: z.number().int(),
  })
  .strict();

export type OutcomesResponse = z.infer<typeof outcomesResponseSchema>;

const legacyRecycleBodySchema = z
  .object({ source_campaign_id: z.number().int().positive() })
  .strict();

export const multiSourceRecycleBodySchema = z
  .object({ source_campaign_ids: z.array(z.number().int().positive()).min(2) })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.source_campaign_ids).size !== value.source_campaign_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_campaign_ids'],
        message: 'source campaign ids must be unique',
      });
    }
  });

export const recycleBodySchema = z.union([legacyRecycleBodySchema, multiSourceRecycleBodySchema]);

export const recyclePreviewBodySchema = multiSourceRecycleBodySchema;

export const recycleBreakdownSchema = z
  .object({
    unique_leads: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    rest_period_failures: z.number().int().min(0),
    nurture_exclusions: z.number().int().min(0),
    untiered_exclusions: z.number().int().min(0),
    personalized_copy_blocks: z.number().int().min(0),
    suppression_recontact_blocks: z.number().int().min(0),
    existing_target_enrollments: z.number().int().min(0),
    prior_content_conflicts: z.number().int().min(0),
    eligible: z.number().int().min(0),
  })
  .strict();

export const recycleSourceContributionSchema = z
  .object({
    source_campaign_id: z.number().int(),
    name: z.string(),
    candidates: z.number().int().min(0),
    eligible: z.number().int().min(0),
  })
  .strict();

export const recyclePreviewResponseSchema = z
  .object({
    breakdown: recycleBreakdownSchema,
    sources: z.array(recycleSourceContributionSchema),
  })
  .strict();

export const recycleCommitResponseSchema = recyclePreviewResponseSchema.extend({
  enrolled: z.number().int().min(0),
  skipped: z.array(z.object({ reason: z.string(), count: z.number().int().min(1) }).strict()),
});

export const coldStorageQuerySchema = pageQuerySchema.extend({
  source_campaign_id: z.coerce.number().int().positive(),
});

export const coldStorageItemSchema = z
  .object({
    lead: z
      .object({
        id: z.number().int(),
        email: z.string(),
        tier: z.enum(LEAD_TIERS).nullable(),
      })
      .strict(),
    completed_at: isoDateTime,
    earliest_recycle_at: isoDateTime,
    eligible: z.boolean(),
  })
  .strict();

export const coldStorageResponseSchema = listOf(coldStorageItemSchema);
