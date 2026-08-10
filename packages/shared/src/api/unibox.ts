// Unibox + enrollment actions + manual-sends (docs/10 §Unibox).
import { z } from 'zod';
import { SENTIMENTS } from '../domain/index';
import { isoDateTime, listOf, pageQuerySchema } from './common';
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
    auto_unsubscribed: z.boolean(),
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

export const snoozeBodySchema = z.object({ until: isoDateTime }).strict();

export const manualSendBodySchema = z
  .object({
    lead_id: z.number().int().positive(),
    campaign_id: z.number().int().positive(),
    mailbox_id: z.number().int().positive().optional(),
    subject: z.string().min(1),
    body: z.string().min(1),
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
