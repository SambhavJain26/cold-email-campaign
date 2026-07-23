// Analytics endpoints (docs/10 §Analytics - 13a-13d + the overview).
import { z } from 'zod';
import { LEAD_TIERS, PERSONALIZATION_MODES } from '../domain/index';
import { metricSchema } from './common';
import { capacityResponseSchema } from './campaigns';

export const overviewQuerySchema = z.object({
  campaign_id: z.coerce.number().int().positive(),
});

export const overviewResponseSchema = z
  .object({
    progress: z
      .object({
        contacted: z.number().int(),
        total: z.number().nullable(),
        pct: z.number(),
      })
      .strict(),
    reply_rate: metricSchema,
    positive_rate: metricSchema,
    meetings: z.object({ count: z.number().int(), per_100: z.number() }).strict(),
    hard_bounce_rate: metricSchema,
    soft_bounce_rate: metricSchema,
    unsubscribe_rate: metricSchema,
    capacity: capacityResponseSchema,
    watch_flags: z.array(z.string()),
  })
  .strict();

export type OverviewResponse = z.infer<typeof overviewResponseSchema>;

export const variantsQuerySchema = z.object({
  sequence_id: z.coerce.number().int().positive(),
  step_no: z.coerce.number().int().min(1).default(1),
});

export const variantAnalyticsRowSchema = z
  .object({
    variant_id: z.number().int(),
    label: z.string(),
    subject_template: z.string(),
    sent: z.number().int(),
    reply_rate: metricSchema,
    positive_rate: metricSchema,
    meetings: z.number().int(),
  })
  .strict();

export type VariantAnalyticsRow = z.infer<typeof variantAnalyticsRowSchema>;

export const variantsResponseSchema = z
  .object({ items: z.array(variantAnalyticsRowSchema) })
  .strict();

/** sequence_id per the doc; campaign_id accepted too (the golden campaign has no sequence). */
export const stepsQuerySchema = z
  .object({
    sequence_id: z.coerce.number().int().positive().optional(),
    campaign_id: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => q.sequence_id !== undefined || q.campaign_id !== undefined, {
    message: 'sequence_id or campaign_id required',
  });

export const stepAnalyticsRowSchema = z
  .object({
    step_no: z.number().int(),
    delivered: z.number().int(),
    positive_replies: z.number().int(),
    positive_rate: metricSchema,
  })
  .strict();

export type StepAnalyticsRow = z.infer<typeof stepAnalyticsRowSchema>;

export const stepsResponseSchema = z.object({ items: z.array(stepAnalyticsRowSchema) }).strict();

export const tiersQuerySchema = z.object({
  campaign_id: z.coerce.number().int().positive(),
});

export const tierAnalyticsRowSchema = z
  .object({
    tier: z.enum(LEAD_TIERS).nullable(),
    contacted: z.number().int(),
    reply_rate: metricSchema,
    positive_rate: metricSchema,
    meetings: z.number().int(),
    mode: z.enum(PERSONALIZATION_MODES),
  })
  .strict();

export type TierAnalyticsRow = z.infer<typeof tierAnalyticsRowSchema>;

export const tiersResponseSchema = z
  .object({
    items: z.array(tierAnalyticsRowSchema),
    promotable: z.object({ tier_c_engaged: z.number().int() }).strict(),
  })
  .strict();

export const healthTrendQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  campaign_id: z.coerce.number().int().positive().optional(),
});

export const dailySeriesRowSchema = z
  .object({
    day: z.string(),
    sent: z.number().int(),
    delivered: z.number().int(),
    replies: z.number().int(),
    hard_bounces: z.number().int(),
    unsubscribes: z.number().int(),
  })
  .strict();

export const watchFlagSchema = z.object({ rule: z.string(), message: z.string() }).strict();

export type DailySeriesRow = z.infer<typeof dailySeriesRowSchema>;
export type WatchFlag = z.infer<typeof watchFlagSchema>;

/** "daily series + sparkline aggregates + watch-rule statuses" (13d), executable form. */
export const healthTrendResponseSchema = z
  .object({
    items: z.array(dailySeriesRowSchema),
    totals: z
      .object({
        sent: z.number().int(),
        delivered: z.number().int(),
        replies: z.number().int(),
        hard_bounces: z.number().int(),
        unsubscribes: z.number().int(),
      })
      .strict(),
    watch_flags: z.array(watchFlagSchema),
  })
  .strict();
