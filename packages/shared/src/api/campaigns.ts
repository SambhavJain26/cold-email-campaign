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
    recycled_from_campaign_id: z.number().int().nullable(),
    enrolled_count: z.number().int().min(0),
    contacted_count: z.number().int().min(0),
    manual_only_count: z.number().int().min(0),
  })
  .strict();
export type CampaignDto = z.infer<typeof campaignSchema>;

export const campaignsListResponseSchema = listOf(campaignSchema);

export const createCampaignBodySchema = z
  .object({
    name: z.string().min(1),
    sequence_id: z.number().int().positive(),
    tier_effort_config: tierEffortConfigSchema.optional(),
    ramp_config: rampConfigSchema.optional(),
    ramp_stages: rampStagesSchema.default(DEFAULT_RAMP_STAGES.map((stage) => ({ ...stage }))),
    variable_overrides: sequenceVariablesSchema.optional(),
    auto_observation: autoObservationConfigSchema.optional(),
    acknowledge_tier_a_manual: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.tier_effort_config?.A ?? 'human_written') === 'human_written' &&
      value.acknowledge_tier_a_manual !== true
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['acknowledge_tier_a_manual'],
        message: 'Acknowledge that Tier A uses the manual composer',
      });
    }
  });
export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

export const patchCampaignBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
    tier_effort_config: tierEffortConfigSchema.optional(),
    ramp_stages: rampStagesSchema.optional(),
    variable_overrides: sequenceVariablesSchema.optional(),
    auto_observation: autoObservationConfigSchema.optional(),
  })
  .strict();
export type PatchCampaignBody = z.infer<typeof patchCampaignBodySchema>;

/** Typed confirmation for irreversible metadata deletion. */
export const deleteCampaignBodySchema = z.object({ confirm: z.string().min(1) }).strict();

export const capacityResponseSchema = z
  .object({
    total_daily_capacity: z.number().int(),
    followups_due_today: z.number().int(),
    sent_so_far_today: z.number().int(),
    room_for_new: z.number().int(),
    ramp_cap_remaining: z.number().int().nullable(),
    ramp_day: z.number().int().positive().nullable(),
    ramp_stage: rampStageSchema.nullable(),
    enrolled_today: z.number().int().min(0),
    suggested: z.number().int(),
  })
  .strict();

export type CapacityResponse = z.infer<typeof capacityResponseSchema>;

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
    ACTIVE: z.number().int(),
    NEW: z.number().int(),
    total: z.number().int(),
  })
  .strict();

export type OutcomesResponse = z.infer<typeof outcomesResponseSchema>;

export const recycleBodySchema = z
  .object({ source_campaign_id: z.number().int().positive() })
  .strict();

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
