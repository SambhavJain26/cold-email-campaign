// Settings + compliance endpoints (docs/10 §Settings). The settings DTO is
// the full docs/03 settings row (snake_case); PUT validates ranges here —
// e.g. pause_hard_pct 1–20 per the contract's example.
import { z } from 'zod';
import { isoDateTime } from './common';

const pct = z.number().min(0).max(100);

export const settingsSchema = z
  .object({
    stop_on_reply: z.boolean(),
    stop_on_hard_bounce: z.boolean(),
    soft_retry_max: z.number().int().min(0).max(10),
    suppress_unsubs: z.boolean(),
    enforce_send_window: z.boolean(),
    optout_detection: z.enum(['auto', 'tag_only']),
    pause_min_sends: z.number().int().min(1),
    pause_hard_pct: z.number().min(1).max(20),
    pause_window_sends: z.number().int().min(1),
    pause_absolute_bounces: z.number().int().min(1),
    pause_absolute_span: z.number().int().min(1),
    resume_cap_pct: z.number().int().min(1).max(100),
    scheduler_tick_minutes: z.number().int().min(1).max(60),
    poll_interval_minutes: z.number().int().min(1).max(120),
    stale_poll_hours: z.number().int().min(1).max(72),
    delivery_confirm_hours: z.number().int().min(1).max(72),
    send_jitter_pct: pct,
    default_timezone: z.string().min(1),
    cold_storage_rest_days: z.number().int().min(0),
  })
  .strict();

/**
 * Legacy stop columns remain readable for old data, but are not operator
 * controls: sequence reply policy owns replies and bounces/STOP always stop.
 */
export const putSettingsBodySchema = settingsSchema
  .omit({
    stop_on_reply: true,
    stop_on_hard_bounce: true,
  })
  .strip();
export type PutSettingsBody = z.infer<typeof putSettingsBodySchema>;

/** GET response: the row + updated_at. */
export const settingsResponseSchema = settingsSchema.extend({ updated_at: isoDateTime }).strict();
export type SettingsDto = z.infer<typeof settingsResponseSchema>;

export const complianceSchema = z
  .object({
    physical_address: z.string(),
    optout_text: z.string().min(1),
  })
  .strict();
export type ComplianceDto = z.infer<typeof complianceSchema>;
