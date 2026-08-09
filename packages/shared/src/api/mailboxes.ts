// Mailbox endpoints (docs/10 §Mailboxes). The Mailbox DTO carries NO secrets,
// ever — response schemas are .strict(), so an accidentally-serialized
// password field fails the response validation loudly.
import { z } from 'zod';
import { MAILBOX_STATUSES } from '../domain/index';
import { isoDateTime } from './common';

export const sendWindowSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1), // ISO weekday, 1=Mon
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .strict();
export type SendWindowDto = z.infer<typeof sendWindowSchema>;

export const mailboxSchema = z
  .object({
    id: z.number().int(),
    display_name: z.string(),
    from_address: z.string(),
    smtp_host: z.string(),
    smtp_port: z.number().int(),
    imap_host: z.string(),
    imap_port: z.number().int(),
    daily_cap: z.number().int(),
    effective_cap: z.number().int(),
    send_window: sendWindowSchema,
    timezone: z.string().min(1),
    status: z.enum(MAILBOX_STATUSES),
    status_reason: z.string().nullable(),
    sent_today: z.number().int(),
    hard_bounce_pct: z.number(),
    seven_day_avg: z.number(),
    last_successful_poll_at: isoDateTime.nullable(),
  })
  .strict();
export type MailboxDto = z.infer<typeof mailboxSchema>;

export const mailboxListResponseSchema = z.object({ items: z.array(mailboxSchema) }).strict();

export const createMailboxBodySchema = z
  .object({
    display_name: z.string().min(1),
    from_address: z.email(),
    smtp_host: z.string().min(1),
    smtp_port: z.number().int().min(1).max(65535).optional(),
    imap_host: z.string().min(1),
    imap_port: z.number().int().min(1).max(65535).optional(),
    auth_type: z.string().min(1).optional(), // default app_password (docs/03)
    password: z.string().min(1),
    daily_cap: z.number().int().min(1).optional(),
    send_window: sendWindowSchema.optional(),
    timezone: z.string().min(1).optional(),
  })
  .strict();
export type CreateMailboxBody = z.infer<typeof createMailboxBodySchema>;

export const patchMailboxBodySchema = createMailboxBodySchema.partial();
export type PatchMailboxBody = z.infer<typeof patchMailboxBodySchema>;

export const testConnectionResponseSchema = z
  .object({
    smtp_ok: z.boolean(),
    imap_ok: z.boolean(),
    round_trip_ms: z.number().optional(),
  })
  .strict();

export const resumeMailboxBodySchema = z
  .object({
    cap_pct: z.union([z.literal(50), z.literal(100)]).optional(),
  })
  .strict();

export const reconnectMailboxBodySchema = z.object({ password: z.string().min(1) }).strict();

export const mailboxVolumeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const mailboxVolumeResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          mailbox_id: z.number().int(),
          series: z.array(z.object({ date: z.string(), sends: z.number().int() }).strict()),
        })
        .strict(),
    ),
    imbalance: z.boolean(),
  })
  .strict();
