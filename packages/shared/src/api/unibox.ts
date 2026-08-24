// Unibox + enrollment actions + manual-sends (docs/10 §Unibox).
import { z } from 'zod';
import { REPLY_DISPOSITIONS, SENTIMENTS } from '../domain/index';
import { isoDate, isoDateTime, listOf, pageQuerySchema } from './common';
import { renderChecksSchema } from './sequences';

export const uniboxItemSchema = z
  .object({
    incoming_message_id: z.number().int(),
    received_at: isoDateTime.nullable(),
    lead: z
      .object({
        id: z.number().int(),
        name: z.string(),
        company: z.string().nullable(),
      })
      .strict(),
    campaign_id: z.number().int(),
    step_no: z.number().int().nullable(),
    snippet: z.string().nullable(),
    effective_sentiment: z.enum(SENTIMENTS).nullable(),
    suggested_sentiment: z.enum(SENTIMENTS).nullable(),
    disposition: z.enum(REPLY_DISPOSITIONS).nullable(),
    recontact_after: isoDate.nullable(),
    auto_unsubscribed: z.boolean(),
    lead_suppressed: z.boolean(),
    sequence_continues: z.boolean(),
    meeting_booked: z.boolean(),
    enrollment_id: z.number().int(),
  })
  .strict();
export type UniboxItemDto = z.infer<typeof uniboxItemSchema>;

export const uniboxQuerySchema = pageQuerySchema.extend({
  bucket: z.enum(['human', 'auto_reply']).default('human'),
  sentiment: z.enum(SENTIMENTS).optional(),
  mailbox_id: z.coerce.number().int().positive().optional(),
  unhandled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export const uniboxListResponseSchema = listOf(uniboxItemSchema);

export const uniboxDetailResponseSchema = uniboxItemSchema
  .extend({
    body_text: z.string().nullable(),
    thread: z.array(
      z
        .object({
          message_id: z.string(),
          step_no: z.number().int(),
          sent_at: isoDateTime,
        })
        .strict(),
    ),
  })
  .strict();

export const tagSentimentBodySchema = z.object({ sentiment: z.enum(SENTIMENTS) }).strict();

export const dispositionReplyBodySchema = z
  .object({
    disposition: z.enum(REPLY_DISPOSITIONS),
    recontact_after: isoDate.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.disposition === 'not_now' && value.recontact_after == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recontact_after'],
        message: 'A future recontact date is required for not_now',
      });
    }
    if (value.disposition !== 'not_now' && value.recontact_after != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recontact_after'],
        message: 'Only not_now accepts a recontact date',
      });
    }
  });

export const snoozeBodySchema = z.object({ until: isoDateTime }).strict();

export const reminderSourceSchema = z.enum(['manual', 'not_now', 'legacy_snooze']);
export const reminderStatusSchema = z.enum(['open', 'done', 'dismissed']);

export const reminderSchema = z
  .object({
    id: z.number().int(),
    enrollment_id: z.number().int(),
    incoming_message_id: z.number().int().nullable(),
    due_date: isoDate,
    note: z.string().nullable(),
    source: reminderSourceSchema,
    status: reminderStatusSchema,
    created_at: isoDateTime,
    completed_at: isoDateTime.nullable(),
    lead: z
      .object({ id: z.number().int(), name: z.string(), company: z.string().nullable() })
      .strict(),
    campaign_id: z.number().int(),
    reply_snippet: z.string().nullable(),
  })
  .strict();
export type ReminderDto = z.infer<typeof reminderSchema>;

export const reminderQuerySchema = pageQuerySchema.extend({
  view: z.enum(['due_today', 'upcoming', 'overdue', 'all']).default('due_today'),
  status: reminderStatusSchema.default('open'),
});
export const reminderListResponseSchema = listOf(reminderSchema).extend({
  open_count: z.number().int().min(0),
});
export const createReminderBodySchema = z
  .object({ due_date: isoDate, note: z.string().max(2000).nullable().optional() })
  .strict();
export const patchReminderBodySchema = z
  .object({
    due_date: isoDate.optional(),
    note: z.string().max(2000).nullable().optional(),
    status: reminderStatusSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one change is required' });

export const manualComposePrefillSchema = z
  .object({
    enrollment_id: z.number().int(),
    lead_id: z.number().int(),
    campaign: z.object({ id: z.number().int(), name: z.string() }).strict(),
    step_no: z.number().int().positive(),
    step_count: z.number().int().positive(),
    due_at: isoDateTime.nullable(),
    personalization_mode: z.enum(['human_written', 'template_researched', 'template_auto']),
    subject: z.string(),
    body: z.string(),
    variant_id: z.number().int().nullable(),
    draft_id: z.number().int().nullable(),
    draft_status: z.enum(['needs_review', 'ready']).nullable(),
    draft_source_import_id: z.number().int().nullable(),
    thread: z
      .object({
        assigned_mailbox_id: z.number().int().nullable(),
        previous_message_ids: z.array(z.string()),
        in_thread: z.boolean(),
      })
      .strict(),
    checks: renderChecksSchema,
  })
  .strict();

export const manualSendBodySchema = z
  .object({
    lead_id: z.number().int().positive(),
    campaign_id: z.number().int().positive(),
    enrollment_id: z.number().int().positive().optional(),
    draft_id: z.number().int().positive().optional(),
    mailbox_id: z.number().int().positive().optional(),
    subject: z.string().min(1),
    body: z.string().min(1),
    allow_recontact: z.boolean().optional(),
  })
  .strict();
export type ManualSendBody = z.infer<typeof manualSendBodySchema>;

export const manualSendResponseSchema = z
  .object({
    enrollment_id: z.number().int(),
    message_id: z.string(),
    checks: renderChecksSchema,
  })
  .strict();
