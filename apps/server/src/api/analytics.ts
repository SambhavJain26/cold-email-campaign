// Analytics route group (B6.9, docs/10 §Analytics): thin mapping over
// MetricsEngine + watchRules — every number's SQL lives in metricsRepo
// (docs/05), nothing is recomputed here.
import type { FastifyInstance } from 'fastify';
import {
  healthTrendQuerySchema,
  healthTrendResponseSchema,
  idParamSchema,
  okResponseSchema,
  overviewQuerySchema,
  overviewResponseSchema,
  stepsQuerySchema,
  stepsResponseSchema,
  tiersQuerySchema,
  tiersResponseSchema,
  variantsQuerySchema,
  variantsResponseSchema,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { campaignIdsForSequence, getCampaign } from '../db/repos/campaignsRepo';
import { tierCEngagedCount, mailboxVolume, type MetricScope } from '../db/repos/metricsRepo';
import { deactivateVariant, getSequenceNested } from '../db/repos/sequencesRepo';
import { capacityToday } from '../services/enrollment';
import {
  mailboxImbalance,
  replyRateDrop,
  unsubClimbing,
  type WatchFlag,
} from '../services/metrics/watchRules';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

const pct = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0,
});

/** The overview/health watch window: the last 30 days of wall/virtual time. */
const WATCH_WINDOW_DAYS = 30;

export async function analyticsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, metrics } = services;

  const requireCampaign = async (id: number) => {
    const row = await getCampaign(db, id);
    if (!row) throw AppError.notFound('campaign');
    return row;
  };

  const watchFlags = async (scope: MetricScope): Promise<WatchFlag[]> => {
    const now = clock.now();
    const from = new Date(now.getTime() - WATCH_WINDOW_DAYS * 86_400_000);
    const series = await metrics.dailySeries(scope, from, now);
    const volume = await mailboxVolume(db, from, now);
    return [replyRateDrop(series), unsubClimbing(series), mailboxImbalance(volume).flag].filter(
      (f): f is WatchFlag => f !== null,
    );
  };

  r.get(
    '/analytics/overview',
    { schema: { querystring: overviewQuerySchema, response: { 200: overviewResponseSchema } } },
    async (req) => {
      await requireCampaign(req.query.campaign_id);
      const scope: MetricScope = { campaignId: req.query.campaign_id };
      const [progress, reply, positive, meetings, hard, soft, unsub, cap, flags] =
        await Promise.all([
          metrics.progress(scope),
          metrics.replyRate(scope),
          metrics.positiveReplyRate(scope),
          metrics.meetings(scope),
          metrics.hardBounceRate(scope),
          metrics.softBounceRate(scope),
          metrics.unsubscribeRate(scope),
          capacityToday({ db, clock }, req.query.campaign_id),
          watchFlags(scope),
        ]);
      return {
        progress: {
          contacted: progress.numerator,
          total: progress.denominator,
          pct: progress.value,
        },
        reply_rate: reply,
        positive_rate: positive,
        meetings: { count: meetings.count, per_100: meetings.per100 },
        hard_bounce_rate: hard,
        soft_bounce_rate: soft,
        unsubscribe_rate: unsub,
        capacity: {
          total_daily_capacity: cap.total,
          followups_due_today: cap.followupsDue,
          sent_so_far_today: cap.sentSoFar,
          room_for_new: cap.roomForNew,
          ramp_cap_remaining: cap.rampCap,
          suggested: cap.suggested,
        },
        watch_flags: flags.map((f) => f.rule),
      };
    },
  );

  r.get(
    '/analytics/variants',
    { schema: { querystring: variantsQuerySchema, response: { 200: variantsResponseSchema } } },
    async (req) => {
      const nested = await getSequenceNested(db, req.query.sequence_id);
      if (!nested) throw AppError.notFound('sequence');
      const stepEntry = nested.steps.find((s) => s.step.stepNo === req.query.step_no);
      if (!stepEntry) throw AppError.notFound('step');
      const stats = new Map((await metrics.variantAnalytics({})).map((v) => [v.variantId, v]));
      return {
        items: stepEntry.variants.map((v) => {
          const s = stats.get(v.id);
          return {
            variant_id: v.id,
            label: v.label,
            subject_template: v.subjectTemplate,
            sent: s?.sent ?? 0,
            reply_rate: s?.replyRate ?? pct(0, 0),
            positive_rate: s?.positiveRate ?? pct(0, 0),
            meetings: s?.meetings ?? 0,
          };
        }),
      };
    },
  );

  r.post(
    '/step-variants/:id/deactivate',
    { schema: { params: idParamSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const found = await deactivateVariant(db, req.params.id);
      if (!found) throw AppError.notFound('variant');
      return { ok: true } as const;
    },
  );

  r.get(
    '/analytics/steps',
    { schema: { querystring: stepsQuerySchema, response: { 200: stepsResponseSchema } } },
    async (req) => {
      // Resolve the campaign scope(s): direct id, or every campaign sending
      // this sequence (aggregated — one sequence can drive several passes).
      let campaignIds: number[];
      if (req.query.campaign_id !== undefined) {
        await requireCampaign(req.query.campaign_id);
        campaignIds = [req.query.campaign_id];
      } else {
        campaignIds = await campaignIdsForSequence(db, req.query.sequence_id!);
      }
      const byStep = new Map<number, { delivered: number; positive: number }>();
      for (const cid of campaignIds) {
        for (const s of await metrics.stepAnalytics({ campaignId: cid })) {
          const agg = byStep.get(s.stepNo) ?? { delivered: 0, positive: 0 };
          agg.delivered += s.delivered;
          agg.positive += s.positiveRepliers;
          byStep.set(s.stepNo, agg);
        }
      }
      return {
        items: [...byStep.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([step_no, agg]) => ({
            step_no,
            delivered: agg.delivered,
            positive_replies: agg.positive,
            positive_rate: pct(agg.positive, agg.delivered),
          })),
      };
    },
  );

  r.get(
    '/analytics/tiers',
    { schema: { querystring: tiersQuerySchema, response: { 200: tiersResponseSchema } } },
    async (req) => {
      await requireCampaign(req.query.campaign_id);
      const scope: MetricScope = { campaignId: req.query.campaign_id };
      const items = (await metrics.tierAnalytics(scope)).map((t) => ({
        // tierStats returns raw text columns; the response schema re-validates
        tier: t.tier as 'A' | 'B' | 'C' | 'nurture' | null,
        contacted: t.contacted,
        reply_rate: t.replyRate,
        positive_rate: t.positiveRate,
        meetings: t.meetings,
        mode: t.mode as 'human_written' | 'template_researched' | 'template_auto',
      }));
      return {
        items,
        promotable: { tier_c_engaged: await tierCEngagedCount(db, scope) },
      };
    },
  );

  r.get(
    '/analytics/health-trend',
    {
      schema: {
        querystring: healthTrendQuerySchema,
        response: { 200: healthTrendResponseSchema },
      },
    },
    async (req) => {
      const scope: MetricScope =
        req.query.campaign_id !== undefined ? { campaignId: req.query.campaign_id } : {};
      const now = clock.now();
      const from = new Date(now.getTime() - req.query.days * 86_400_000);
      const items = await metrics.dailySeries(scope, from, now);
      const totals = items.reduce(
        (a, r2) => ({
          sent: a.sent + r2.sent,
          delivered: a.delivered + r2.delivered,
          replies: a.replies + r2.replies,
          hard_bounces: a.hard_bounces + r2.hard_bounces,
          unsubscribes: a.unsubscribes + r2.unsubscribes,
        }),
        { sent: 0, delivered: 0, replies: 0, hard_bounces: 0, unsubscribes: 0 },
      );
      return { items, totals, watch_flags: await watchFlags(scope) };
    },
  );
}
