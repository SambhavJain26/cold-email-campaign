// Leads + suppression endpoints (docs/10 §Leads & imports).
import { z } from 'zod';
import { ENROLLMENT_STATES, EVENT_TYPES, LEAD_TIERS } from '../domain/index';
import { isoDateTime, listOf, pageQuerySchema } from './common';

/** Query/filter tier vocabulary: real tiers + the 'untiered' pseudo-value (decision R). */
export const leadTierFilterSchema = z.enum([...LEAD_TIERS, 'untiered'] as const);

export const leadSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    company: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    tier: z.enum(LEAD_TIERS).nullable(),
    is_suppressed: z.boolean(),
    custom_fields: z.record(z.string(), z.string()),
    latest_enrollment: z
      .object({
        campaign_id: z.number().int(),
        campaign_name: z.string(),
        current_state: z.enum(ENROLLMENT_STATES),
        current_step_no: z.number().int(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LeadDto = z.infer<typeof leadSchema>;

export const leadsQuerySchema = pageQuerySchema.extend({
  tier: leadTierFilterSchema.optional(),
  state: z.string().optional(),
  campaign_id: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
  suppressed: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

/** List envelope + the untiered banner count (decision R). */
export const leadsListResponseSchema = listOf(leadSchema).extend({
  untiered_count: z.number().int().min(0),
});

export const eventViewSchema = z
  .object({
    id: z.number().int(),
    type: z.enum(EVENT_TYPES),
    occurred_at: isoDateTime,
    campaign_id: z.number().int().nullable(),
    enrollment_id: z.number().int().nullable(),
    step_no: z.number().int().nullable(),
    mailbox_id: z.number().int().nullable(),
    attributes: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EventViewDto = z.infer<typeof eventViewSchema>;

export const leadDetailResponseSchema = leadSchema
  .extend({
    notes: z.string().nullable(),
    timeline: z.array(eventViewSchema),
    manual_sendable_enrollments: z.array(
      z
        .object({
          enrollment_id: z.number().int(),
          campaign_id: z.number().int(),
          campaign_name: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const patchLeadBodySchema = z
  .object({
    tier: z.enum(LEAD_TIERS).nullable().optional(),
    notes: z.string().nullable().optional(),
    custom_fields: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type PatchLeadBody = z.infer<typeof patchLeadBodySchema>;

/** LeadFilter in body form (bulk-tier's "select all matching"). */
export const leadFilterSchema = z
  .object({
    tier: leadTierFilterSchema.optional(),
    state: z.string().optional(),
    campaign_id: z.number().int().positive().optional(),
    q: z.string().optional(),
    suppressed: z.boolean().optional(),
  })
  .strict();

export const bulkTierBodySchema = z
  .object({
    lead_ids: z.array(z.number().int().positive()).optional(),
    filter: leadFilterSchema.optional(),
    tier: z.enum(LEAD_TIERS).nullable(),
  })
  .strict();
export type BulkTierBody = z.infer<typeof bulkTierBodySchema>;

export const bulkTierResponseSchema = z.object({ updated: z.number().int().min(0) }).strict();

/** Decision U: the typed-confirm body — must equal the email being un-suppressed. */
export const deleteSuppressionBodySchema = z.object({ confirm: z.string() }).strict();

/** Irreversible privacy action: confirmation must match the current email. */
export const eraseLeadBodySchema = z.object({ confirm: z.string() }).strict();
