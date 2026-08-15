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

/**
 * Base URL of the public unsubscribe endpoint (docs/16 §8). Empty is the
 * normal state until a real sending domain exists — the renderer then emits no
 * link and no List-Unsubscribe header. HTTPS only, no trailing slash, and no
 * query/fragment: the token is appended as `/u/<token>` and must never share a
 * URL with anything that could carry recipient data.
 */
export const unsubscribeBaseUrlSchema = z.string().refine(
  (v) => {
    if (v === '') return true;
    if (!v.startsWith('https://') || v.endsWith('/')) return false;
    try {
      const u = new URL(v);
      return u.search === '' && u.hash === '' && u.hostname.includes('.');
    } catch {
      return false;
    }
  },
  { message: 'must be empty or an https:// URL with no trailing slash, query or fragment' },
);

export const complianceSchema = z
  .object({
    physical_address: z.string(),
    optout_text: z.string().min(1),
    unsubscribe_base_url: unsubscribeBaseUrlSchema,
  })
  .strict();
export type ComplianceDto = z.infer<typeof complianceSchema>;
