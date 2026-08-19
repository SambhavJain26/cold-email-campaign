// Settings + compliance route group (B6.10, docs/10 §Settings). PUT /settings
// is full-replace of the editable row; PUT /compliance refuses an empty
// physical address with 422 — an empty address halts ALL sends (docs/08 §4),
// so the API won't let it in silently.
import type { FastifyInstance } from 'fastify';
import {
  complianceSchema,
  putSettingsBodySchema,
  settingsResponseSchema,
  type ComplianceDto,
  type PutSettingsBody,
  type SettingsDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import {
  getComplianceSettings,
  getSettings,
  updateComplianceSettings,
  updateSettings,
  type ComplianceRow,
  type SettingsRow,
} from '../db/repos/settingsRepo';
import { AppError } from './errors';
import { hasAnySentEvent } from '../db/repos/eventsRepo';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toComplianceDto(row: ComplianceRow): ComplianceDto {
  return {
    physical_address: row.physicalAddress,
    optout_text: row.optoutText,
    unsubscribe_base_url: row.unsubscribeBaseUrl,
  };
}

function toSettingsDto(row: SettingsRow): SettingsDto {
  return {
    stop_on_reply: row.stopOnReply,
    stop_on_hard_bounce: row.stopOnHardBounce,
    soft_retry_max: row.softRetryMax,
    suppress_unsubs: row.suppressUnsubs,
    enforce_send_window: row.enforceSendWindow,
    optout_detection: row.optoutDetection as 'auto' | 'tag_only',
    pause_min_sends: row.pauseMinSends,
    pause_hard_pct: Number(row.pauseHardPct),
    pause_window_sends: row.pauseWindowSends,
    pause_absolute_bounces: row.pauseAbsoluteBounces,
    pause_absolute_span: row.pauseAbsoluteSpan,
    resume_cap_pct: row.resumeCapPct,
    scheduler_tick_minutes: row.schedulerTickMinutes,
    poll_interval_minutes: row.pollIntervalMinutes,
    stale_poll_hours: row.stalePollHours,
    delivery_confirm_hours: row.deliveryConfirmHours,
    send_jitter_pct: row.sendJitterPct,
    default_timezone: row.defaultTimezone,
    cold_storage_rest_days: row.coldStorageRestDays,
    max_mailbox_daily_cap: row.maxMailboxDailyCap,
    max_ramp_daily_enroll_cap: row.maxRampDailyEnrollCap,
    min_ramp_days: row.minRampDays,
    updated_at: row.updatedAt.toISOString(),
  };
}

function toSettingsColumns(body: PutSettingsBody) {
  return {
    softRetryMax: body.soft_retry_max,
    suppressUnsubs: body.suppress_unsubs,
    enforceSendWindow: body.enforce_send_window,
    optoutDetection: body.optout_detection,
    pauseMinSends: body.pause_min_sends,
    pauseHardPct: String(body.pause_hard_pct), // numeric column — string in drizzle
    pauseWindowSends: body.pause_window_sends,
    pauseAbsoluteBounces: body.pause_absolute_bounces,
    pauseAbsoluteSpan: body.pause_absolute_span,
    resumeCapPct: body.resume_cap_pct,
    schedulerTickMinutes: body.scheduler_tick_minutes,
    pollIntervalMinutes: body.poll_interval_minutes,
    stalePollHours: body.stale_poll_hours,
    deliveryConfirmHours: body.delivery_confirm_hours,
    sendJitterPct: body.send_jitter_pct,
    defaultTimezone: body.default_timezone,
    coldStorageRestDays: body.cold_storage_rest_days,
    maxMailboxDailyCap: body.max_mailbox_daily_cap,
    maxRampDailyEnrollCap: body.max_ramp_daily_enroll_cap,
    minRampDays: body.min_ramp_days,
  };
}

export async function settingsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock } = services;

  r.get('/settings', { schema: { response: { 200: settingsResponseSchema } } }, async () =>
    toSettingsDto(await getSettings(db)),
  );

  r.put(
    '/settings',
    { schema: { body: putSettingsBodySchema, response: { 200: settingsResponseSchema } } },
    async (req) => {
      const current = await getSettings(db);
      if (
        req.body.delivery_confirm_hours !== current.deliveryConfirmHours &&
        (await hasAnySentEvent(db))
      ) {
        throw new AppError(
          'conflict',
          409,
          'delivery_confirm_hours cannot change after the first send; it would make projection replay unstable',
        );
      }
      try {
        const row = await updateSettings(db, toSettingsColumns(req.body), clock.now());
        return toSettingsDto(row);
      } catch (error) {
        if ((error as { code?: string }).code === '23514') {
          throw new AppError(
            'conflict',
            409,
            'delivery_confirm_hours cannot change after the first send; it would make projection replay unstable',
          );
        }
        throw error;
      }
    },
  );

  r.get('/compliance', { schema: { response: { 200: complianceSchema } } }, async () =>
    toComplianceDto(await getComplianceSettings(db)),
  );

  r.put(
    '/compliance',
    { schema: { body: complianceSchema, response: { 200: complianceSchema } } },
    async (req) => {
      if (req.body.physical_address.trim() === '') {
        // Semantic 422 with the closed `validation` code (convention 2026-07-23).
        throw new AppError(
          'validation',
          422,
          'physical_address must be non-empty — an empty address refuses all sends (CAN-SPAM guard)',
        );
      }
      const row = await updateComplianceSettings(
        db,
        {
          physicalAddress: req.body.physical_address,
          optoutText: req.body.optout_text,
          unsubscribeBaseUrl: req.body.unsubscribe_base_url.trim(),
        },
        clock.now(),
      );
      return toComplianceDto(row);
    },
  );
}
