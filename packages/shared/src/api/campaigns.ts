// Campaign endpoints (docs/10 §Campaigns): CRUD, the capacity meter,
// enroll/recycle (dual body shapes), the Stage-9 outcomes panel, cold storage.
import { z } from 'zod';
import { CAMPAIGN_STATUSES, LEAD_TIERS, PERSONALIZATION_MODES } from '../domain/index';
import { isoDateTime, listOf } from './common';

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

export const campaignSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    status: z.enum(CAMPAIGN_STATUSES),
    sequence_id: z.number().int().nullable(),
    tier_effort_config: tierEffortConfigSchema,
    ramp_config: rampConfigSchema,
    recycled_from_campaign_id: z.number().int().nullable(),
    enrolled_count: z.number().int().min(0),
    contacted_count: z.number().int().min(0),
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
  })
  .strict();

export const patchCampaignBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(['active', 'paused', 'archived']).optional(),
  })
  .strict();

export const capacityResponseSchema = z
  .object({
    total_daily_capacity: z.number().int(),
    followups_due_today: z.number().int(),
    sent_so_far_today: z.number().int(),
    room_for_new: z.number().int(),
    ramp_cap_remaining: z.number().int().nullable(),
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

export const coldStorageQuerySchema = z.object({
  source_campaign_id: z.coerce.number().int().positive(),
});

export const coldStorageResponseSchema = z
  .object({
    items: z.array(
      z
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
        .strict(),
    ),
  })
  .strict();
