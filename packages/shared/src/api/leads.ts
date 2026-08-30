// Leads + suppression endpoints (docs/10 §Leads & imports).
import { z } from 'zod';
import {
  CURRENT_LEAD_TIERS,
  ENROLLMENT_STATES,
  EVENT_TYPES,
  HISTORICAL_LEAD_TIERS,
  OUTREACH_STATUSES,
} from '../domain/index';
import { isoDateTime, listOf, pageQuerySchema } from './common';

/** Query/filter tier vocabulary: real tiers + the 'untiered' pseudo-value (decision R). */
export const leadTierFilterSchema = z.enum([...CURRENT_LEAD_TIERS, 'untiered'] as const);
export const campaignScopeSchema = z.enum(['pool', 'enrolled', 'both']);

export const leadSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    company: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    tier: z.enum(HISTORICAL_LEAD_TIERS).nullable(),
    outreach_status: z.enum(OUTREACH_STATUSES),
    is_suppressed: z.boolean(),
    custom_fields: z.record(z.string(), z.string()),
    pool_assignment: z
      .object({
        campaign_id: z.number().int(),
        campaign_name: z.string(),
        status: z.enum(['available', 'enrolled', 'released']),
      })
      .strict()
      .optional(),
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
  pool_campaign_id: z.coerce.number().int().positive().optional(),
  campaign_scope: campaignScopeSchema.optional(),
  q: z.string().optional(),
  suppressed: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  outreach_status: z.enum(OUTREACH_STATUSES).optional(),
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

/**
 * Single-lead creation (finding 10). Deliberately routed through the SAME
 * ingest path as a CSV upload, so normalization, dedup, hygiene and the
 * commit-time suppression re-check cannot diverge between the two.
 */
export const createLeadBodySchema = z
  .object({
    email: z.string().min(1),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    company: z.string().optional(),
    website: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();
export type CreateLeadBody = z.infer<typeof createLeadBodySchema>;

/** `created:false` carries the hygiene flag that refused the row. */
export const createLeadResponseSchema = z
  .object({
    created: z.boolean(),
    reason: z
      .enum(['invalid', 'duplicate', 'suppressed', 'role_based', 'ok', 'missing_first_name'])
      .optional(),
  })
  .strict();

export const patchLeadBodySchema = z
  .object({
    tier: z.enum(CURRENT_LEAD_TIERS).nullable().optional(),
    outreach_status: z.enum(OUTREACH_STATUSES).optional(),
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
    pool_campaign_id: z.number().int().positive().optional(),
    campaign_scope: campaignScopeSchema.optional(),
    q: z.string().optional(),
    suppressed: z.boolean().optional(),
    outreach_status: z.enum(OUTREACH_STATUSES).optional(),
  })
  .strict();

export const bulkTierBodySchema = z
  .object({
    lead_ids: z.array(z.number().int().positive()).optional(),
    filter: leadFilterSchema.optional(),
    tier: z.enum(CURRENT_LEAD_TIERS).nullable(),
  })
  .strict();
export type BulkTierBody = z.infer<typeof bulkTierBodySchema>;

export const bulkTierResponseSchema = z.object({ updated: z.number().int().min(0) }).strict();

export const bulkOutreachStatusBodySchema = z
  .object({
    lead_ids: z.array(z.number().int().positive()).optional(),
    filter: leadFilterSchema.optional(),
    outreach_status: z.enum(OUTREACH_STATUSES),
  })
  .strict();
export type BulkOutreachStatusBody = z.infer<typeof bulkOutreachStatusBodySchema>;

/** Decision U: the typed-confirm body — must equal the email being un-suppressed. */
export const deleteSuppressionBodySchema = z.object({ confirm: z.string() }).strict();

/** Irreversible privacy action: confirmation must match the current email. */
export const eraseLeadBodySchema = z.object({ confirm: z.string() }).strict();
