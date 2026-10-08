import { z } from 'zod';
import { isoDateTime, listOf, pageQuerySchema } from './common';

export const automationSchema = z.enum(['automatic', 'not_detected', 'uncertain']);
export const relationshipSchema = z.enum(['in_thread', 'separate', 'unmatched']);
export const authorshipSchema = z.enum(['human', 'automatic', 'unsure']);
export const sendingStateSchema = z.enum([
  'held',
  'running',
  'delayed',
  'stopped',
  'suppressed',
  'completed',
  'bounced',
  'not_enrolled',
]);
export const incomingRowSchema = z
  .object({
    lead_id: z.number(),
    enrollment_id: z.number().nullable(),
    assigned_mailbox_id: z.number().nullable(),
    next_send_at: isoDateTime.nullable(),
    resume_due_at: isoDateTime.nullable(),
    campaign_id: z.number(),
    name: z.string(),
    email: z.string(),
    company: z.string().nullable(),
    campaign_name: z.string(),
    campaign_status: z.string(),
    sending_state: sendingStateSchema,
    lifecycle: z.string(),
    stop_origin: z.enum(['manual', 'legacy']).nullable(),
    delayed_until: isoDateTime.nullable(),
    next_step: z.number().nullable(),
    revision: z.number(),
    hold_ids: z.array(z.number()),
    message_count: z.number(),
    unacknowledged_count: z.number(),
    latest_received_at: isoDateTime.nullable(),
  })
  .strict();
export type IncomingReviewRow = z.infer<typeof incomingRowSchema>;
export const incomingRowsQuerySchema = pageQuerySchema.extend({
  campaign_id: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  view: z.enum(['needs_review', 'all', 'acknowledged']).default('needs_review'),
  mailbox_id: z.coerce.number().int().positive().optional(),
  sending_state: sendingStateSchema.optional(),
});
export const incomingRowsResponseSchema = listOf(incomingRowSchema);
export const incomingMessageSchema = z
  .object({
    id: z.number(),
    from_address: z.string().nullable(),
    subject: z.string().nullable(),
    received_at: isoDateTime.nullable(),
    automation: automationSchema,
    relationship: relationshipSchema,
    authorship: authorshipSchema,
    sentiment: z.enum(['positive', 'neutral', 'negative']).nullable(),
    policy_version: z.string(),
    revision: z.number(),
    linking_status: z.string(),
    primary_enrollment_id: z.number().nullable(),
    body_text: z.string().nullable(),
    body_html: z.string().nullable(),
    new_text: z.string().nullable(),
    quoted_text: z.string().nullable(),
    snippet: z.string().nullable(),
    capture_status: z.enum(['captured', 'legacy_preview', 'oversized', 'unavailable', 'deleted']),
    acknowledged: z.boolean(),
    links: z.array(
      z.object({
        lead_id: z.number(),
        campaign_id: z.number(),
        enrollment_id: z.number().nullable(),
        matching_method: z.string(),
      }),
    ),
    history: z.array(
      z.object({
        id: z.number(),
        kind: z.string(),
        occurred_at: isoDateTime,
        attributes: z.record(z.string(), z.unknown()),
      }),
    ),
  })
  .strict();
export type IncomingReviewMessage = z.infer<typeof incomingMessageSchema>;
export const incomingMessageListSchema = listOf(incomingMessageSchema);
export const incomingContextSchema = z.object({
  row: incomingRowSchema.nullable(),
  messages: z.array(incomingMessageSchema),
  history: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      occurred_at: isoDateTime,
      attributes: z.record(z.string(), z.unknown()),
    }),
  ),
  sent: z.array(
    z.object({
      message_id: z.string(),
      step_no: z.number(),
      sent_at: isoDateTime,
      subject: z.string().nullable(),
      body_text: z.string().nullable(),
      conversation_id: z.string(),
    }),
  ),
});
export const reviewMutationSchema = z.object({
  operation_id: z.string().uuid(),
  expected_revision: z.number().int().min(0),
});
export const reviewActionSchema = reviewMutationSchema
  .extend({
    action: z.enum(['continue', 'delay', 'stop', 'correct_stop', 'restore_legacy', 'suppress']),
    hold_ids: z.array(z.number().int().positive()).default([]),
    reviewed_message_ids: z.array(z.number().int().positive()).default([]),
    until: isoDateTime.optional(),
    timezone: z.string().optional(),
    local_time: z.string().optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    confirm: z.string().optional(),
  })
  .strict();
export const incomingLinkSchema = reviewMutationSchema
  .extend({ lead_id: z.number().int().positive(), campaign_id: z.number().int().positive() })
  .strict();
export const incomingAuthorshipBodySchema = reviewMutationSchema
  .extend({
    authorship: authorshipSchema,
    sentiment: z.enum(['positive', 'neutral', 'negative']).nullable().optional(),
  })
  .strict();
export const incomingAckSchema = z
  .object({
    operation_id: z.string().uuid(),
    action: z.enum(['acknowledge', 'undo', 'return']),
    undo_operation_id: z.string().uuid().optional(),
    messages: z
      .array(
        z.object({
          id: z.number().int().positive(),
          expected_revision: z.number().int().min(0),
          campaign_id: z.number().int().positive().optional(),
          lead_id: z.number().int().positive().optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict();
export const incomingRetentionSchema = z
  .object({ days: z.number().int().min(1).max(3650).nullable() })
  .strict();
