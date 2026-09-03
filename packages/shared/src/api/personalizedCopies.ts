import { z } from 'zod';
import { isoDateTime } from './common';

export const personalizedCopyStatusSchema = z.enum(['needs_review', 'ready', 'sent']);

export const personalizedCopySourceSchema = z
  .object({
    id: z.number().int().positive(),
    lead_id: z.number().int().positive(),
    slot_no: z.number().int().positive(),
    target_step_no: z.number().int().positive().nullable(),
    subject: z.string(),
    body: z.string(),
    status: z.enum(['needs_review', 'ready']),
    source_import_id: z.number().int().positive().nullable(),
    content_hash: z.string(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
  })
  .strict();
export type PersonalizedCopySourceDto = z.infer<typeof personalizedCopySourceSchema>;

export const campaignPersonalizedCopySchema = z
  .object({
    id: z.number().int().positive(),
    lead_id: z.number().int().positive(),
    campaign_id: z.number().int().positive(),
    campaign_name: z.string(),
    sequence_step_id: z.number().int().positive(),
    step_no: z.number().int().positive(),
    subject: z.string(),
    body: z.string(),
    status: personalizedCopyStatusSchema,
    source_copy_id: z.number().int().positive().nullable(),
    source_import_id: z.number().int().positive().nullable(),
    content_hash: z.string(),
    sent_event_id: z.number().int().positive().nullable(),
    sent_message_id: z.string().nullable(),
    sent_subject: z.string().nullable(),
    created_at: isoDateTime,
    updated_at: isoDateTime,
    sent_at: isoDateTime.nullable(),
  })
  .strict();
export type CampaignPersonalizedCopyDto = z.infer<typeof campaignPersonalizedCopySchema>;

export const personalizedCopiesResponseSchema = z
  .object({
    sources: z.array(personalizedCopySourceSchema),
    campaign_copies: z.array(campaignPersonalizedCopySchema),
  })
  .strict();
export type PersonalizedCopiesResponse = z.infer<typeof personalizedCopiesResponseSchema>;

export const personalizedCopyWriteBodySchema = z
  .object({
    subject: z.string().optional(),
    body: z.string().optional(),
    action: z.enum(['save_draft', 'mark_ready', 'copy_from_source']).default('save_draft'),
    source_slot_no: z.number().int().positive().optional(),
    replace: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'copy_from_source') {
      if (value.source_slot_no === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['source_slot_no'],
          message: 'source slot is required',
        });
      }
      return;
    }
    if (value.subject === undefined || value.body === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'subject and body are required when saving personalized copy',
      });
    }
  });
export type PersonalizedCopyWriteBody = z.infer<typeof personalizedCopyWriteBodySchema>;

export const personalizedCopySourceWriteResponseSchema = z
  .object({
    result: z.enum(['created', 'replaced', 'skipped']),
    source: personalizedCopySourceSchema,
  })
  .strict();

export const campaignPersonalizedCopyWriteResponseSchema = z
  .object({
    result: z.enum(['created', 'replaced', 'skipped']),
    copy: campaignPersonalizedCopySchema,
  })
  .strict();
