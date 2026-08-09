// System endpoints (docs/10 §Settings… + docs/13 §5 advance-clock).
import { z } from 'zod';
import { INCOMING_CLASSES } from '../domain/index';
import { isoDateTime, listOf, pageQuerySchema } from './common';

export const systemStatusResponseSchema = z
  .object({
    scheduler_last_tick_at: isoDateTime.nullable(),
    transport_mode: z.enum(['mock', 'smtp_imap']),
    pollers: z.array(
      z
        .object({
          mailbox_id: z.number().int(),
          last_successful_poll_at: isoDateTime.nullable(),
        })
        .strict(),
    ),
    pending_jobs: z.number().int(),
    send_blockers: z.array(
      z
        .object({
          code: z.enum([
            'compliance_missing_address',
            'no_healthy_mailbox',
            'send_window_closed',
            'daily_capacity_exhausted',
            'pacing_delay',
            'manual_only',
          ]),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const rebuildBodySchema = z.object({ dry_run: z.boolean() }).strict();

export const rebuildResponseSchema = z
  .object({
    diffs: z.number().int(),
    details: z
      .array(
        z.object({
          enrollment_id: z.number().int(),
          field: z.string(),
          stored: z.unknown(),
          derived: z.unknown(),
        }),
      )
      .optional(),
  })
  .strict();

export const incomingMessagesQuerySchema = pageQuerySchema.extend({
  classification: z.enum(INCOMING_CLASSES).optional(),
  mailbox_id: z.coerce.number().int().positive().optional(),
});

export const incomingMessageDebugRowSchema = z
  .object({
    id: z.number().int(),
    mailbox_id: z.number().int(),
    from_address: z.string().nullable(),
    subject: z.string().nullable(),
    classification: z.enum(INCOMING_CLASSES),
    dsn_status: z.string().nullable(),
    matched_enrollment_id: z.number().int().nullable(),
    resulting_event_ids: z.array(z.number().int()),
    processed_at: isoDateTime,
  })
  .strict();

export const incomingMessagesResponseSchema = listOf(incomingMessageDebugRowSchema);

/** Test-only (docs/13 §5): registered only when SIMULATED_CLOCK is active. */
export const advanceClockBodySchema = z
  .object({
    days: z.number().int().min(0).optional(),
    hours: z.number().int().min(0).optional(),
    minutes: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((b) => (b.days ?? 0) + (b.hours ?? 0) + (b.minutes ?? 0) > 0, {
    message: 'advance by at least one minute',
  });

export const advanceClockResponseSchema = z
  .object({
    ok: z.literal(true),
    now: isoDateTime,
    ticks: z.number().int(),
  })
  .strict();
