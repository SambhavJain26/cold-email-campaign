// Mailbox endpoints (docs/10 §Mailboxes). The Mailbox DTO carries NO secrets,
// ever — response schemas are .strict(), so an accidentally-serialized
// password field fails the response validation loudly.
import { z } from 'zod';
import { MAILBOX_STATUSES } from '../domain/index';
import { ianaTimezoneSchema, isoDateTime } from './common';

export const sendWindowSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1), // ISO weekday, 1=Mon
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .strict();
export type SendWindowDto = z.infer<typeof sendWindowSchema>;

const intervalMinutes = z.number().int().min(1).max(1440);
const checkRange = (
  body: {
    send_interval_min_minutes?: number;
    send_interval_max_minutes?: number;
    send_interval_minutes?: number;
  },
  ctx: z.RefinementCtx,
) => {
  const min = body.send_interval_min_minutes;
  const max = body.send_interval_max_minutes;
  if (
    (min !== undefined || max !== undefined) &&
    (min === undefined || max === undefined || min >= max)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['send_interval_max_minutes'],
      message: 'Provide both minutes; minimum must be below maximum',
    });
  }
  if (min !== undefined && body.send_interval_minutes !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['send_interval_minutes'],
      message: 'Use a range or the legacy interval, not both',
    });
  }
};

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
    send_interval_minutes: z.number().int().min(1).max(1440).nullable().optional(),
    send_interval_min_minutes: intervalMinutes.nullable().optional(),
    send_interval_max_minutes: intervalMinutes.nullable().optional(),
    next_allowed_send_at: isoDateTime.nullable().optional(),
    effective_cap: z.number().int(),
    send_window: sendWindowSchema,
    timezone: ianaTimezoneSchema,
    /**
     * Folders polled for replies (finding 13). INBOX-only by default; add the
     * provider's spam folder ("[Gmail]/Spam", "Junk", "Junk E-Mail") to stop a
     * spam-filed reply from being invisible. Each folder keeps its OWN UID
     * cursor, seeded from UIDNEXT when first added.
     */
    poll_folders: z.array(z.string().min(1)).min(1),
    auth_type: z.enum(['app_password', 'google_oauth']),
    oauth_connected: z.boolean(),
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
    smtp_host: z.string().min(1).optional(),
    smtp_port: z.number().int().min(1).max(65535).optional(),
    imap_host: z.string().min(1).optional(),
    imap_port: z.number().int().min(1).max(65535).optional(),
    auth_type: z.enum(['app_password', 'google_oauth']).optional(),
    password: z.string().min(1).optional(),
    daily_cap: z.number().int().min(1).optional(),
    send_interval_minutes: z.number().int().min(1).max(1440).optional(),
    send_interval_min_minutes: intervalMinutes.optional(),
    send_interval_max_minutes: intervalMinutes.optional(),
    send_window: sendWindowSchema.optional(),
    timezone: ianaTimezoneSchema.optional(),
    poll_folders: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    checkRange(body, ctx);
    if ((body.auth_type ?? 'app_password') === 'app_password' && !body.password) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'password is required for app-password mailboxes',
      });
    }
    if ((body.auth_type ?? 'app_password') === 'app_password' && !body.smtp_host) {
      ctx.addIssue({ code: 'custom', path: ['smtp_host'], message: 'smtp_host is required' });
    }
    if ((body.auth_type ?? 'app_password') === 'app_password' && !body.imap_host) {
      ctx.addIssue({ code: 'custom', path: ['imap_host'], message: 'imap_host is required' });
    }
    if (body.auth_type === 'google_oauth' && body.password !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'password is not accepted for Google OAuth mailboxes',
      });
    }
  });
export type CreateMailboxBody = z.infer<typeof createMailboxBodySchema>;

export const patchMailboxBodySchema = z
  .object({
    display_name: z.string().min(1).optional(),
    from_address: z.email().optional(),
    smtp_host: z.string().min(1).optional(),
    smtp_port: z.number().int().min(1).max(65535).optional(),
    imap_host: z.string().min(1).optional(),
    imap_port: z.number().int().min(1).max(65535).optional(),
    password: z.string().min(1).optional(),
    daily_cap: z.number().int().min(1).optional(),
    send_interval_minutes: z.number().int().min(1).max(1440).optional(),
    send_interval_min_minutes: intervalMinutes.optional(),
    send_interval_max_minutes: intervalMinutes.optional(),
    send_window: sendWindowSchema.optional(),
    timezone: ianaTimezoneSchema.optional(),
    poll_folders: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine(checkRange);
export type PatchMailboxBody = z.infer<typeof patchMailboxBodySchema>;

export const testConnectionResponseSchema = z
  .object({
    smtp_ok: z.boolean(),
    imap_ok: z.boolean(),
    round_trip_ms: z.number().optional(),
    folders: z.array(
      z
        .object({
          name: z.string().min(1),
          exists: z.boolean(),
          special_use: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const mailboxFolderSchema = z
  .object({
    name: z.string().min(1),
    special_use: z.string().nullable(),
  })
  .strict();

export const mailboxFoldersResponseSchema = z
  .object({ items: z.array(mailboxFolderSchema) })
  .strict();

export const resumeMailboxBodySchema = z
  .object({
    cap_pct: z.union([z.literal(50), z.literal(100)]).optional(),
  })
  .strict();

export const reconnectMailboxBodySchema = z.object({ password: z.string().min(1) }).strict();

export const googleOauthStartResponseSchema = z.object({ authorization_url: z.url() }).strict();

export const googleOauthDisconnectResponseSchema = z.object({ ok: z.literal(true) }).strict();

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
