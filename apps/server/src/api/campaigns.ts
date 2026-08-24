// Campaign route group (B6.6, docs/10 §Campaigns). Enroll/recycle wrap the
// B3.9/B5.7 services — capacity gate, recycle hash guard, nurture rules all
// live there; this layer only maps shapes and typed errors.
import type { FastifyInstance } from 'fastify';
import {
  campaignSchema,
  campaignsListResponseSchema,
  capacityResponseSchema,
  coldStorageQuerySchema,
  coldStorageResponseSchema,
  createCampaignBodySchema,
  deleteCampaignBodySchema,
  enrollBodySchema,
  enrollResponseSchema,
  idParamSchema,
  outcomesResponseSchema,
  okResponseSchema,
  pageQuerySchema,
  patchCampaignBodySchema,
  recycleBodySchema,
  type CampaignDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import {
  campaignCounts,
  createCampaign,
  deleteCampaignIfUnreferenced,
  getCampaign,
  listCampaigns,
  outcomeCounts,
  patchCampaign,
  rampOf,
  tierEffortOf,
  type CampaignCounts,
  type CampaignRow,
} from '../db/repos/campaignsRepo';
import { getSequenceNested } from '../db/repos/sequencesRepo';
import {
  capacityToday,
  coldStorage,
  enroll,
  enrollByIds,
  recycle,
  type EnrollResult,
} from '../services/enrollment';
import { getSettings } from '../db/repos/settingsRepo';
import { checkRamp } from '../services/guardrails';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toCampaignDto(row: CampaignRow, counts: CampaignCounts): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    sequence_id: row.sequenceId,
    tier_effort_config: tierEffortOf(row),
    ramp_config: rampOf(row),
    recycled_from_campaign_id: row.recycledFromCampaignId,
    enrolled_count: counts.enrolledCount,
    contacted_count: counts.contactedCount,
    manual_only_count: counts.manualOnlyCount,
  };
}

function toEnrollResponse(r: EnrollResult) {
  return { enrolled: r.enrolled, skipped: r.skipped };
}

export async function campaignsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, store, sequences } = services;
  const enrollDeps = { db, store, clock, sequences };

  const requireCampaign = async (id: number): Promise<CampaignRow> => {
    const row = await getCampaign(db, id);
    if (!row) throw AppError.notFound('campaign');
    return row;
  };

  r.get(
    '/campaigns',
    { schema: { querystring: pageQuerySchema, response: { 200: campaignsListResponseSchema } } },
    async (req) => {
      const { page, per_page } = req.query;
      const { items, total } = await listCampaigns(db, page, per_page);
      return {
        items: items.map((i) => toCampaignDto(i.campaign, i.counts)),
        total,
        page,
        per_page,
      };
    },
  );

  r.post(
    '/campaigns',
    { schema: { body: createCampaignBodySchema, response: { 200: campaignSchema } } },
    async (req) => {
      if (!(await getSequenceNested(db, req.body.sequence_id))) {
        throw AppError.notFound('sequence');
      }
      // Launch guardrail (0011). Ramp is create-only (docs/12 §6(d)), so this
      // is the single point where an unsafe ramp could enter the system.
      const s = await getSettings(db);
      const violation = checkRamp(req.body.ramp_config, {
        maxMailboxDailyCap: s.maxMailboxDailyCap,
        maxRampDailyEnrollCap: s.maxRampDailyEnrollCap,
        minRampDays: s.minRampDays,
      });
      if (violation) throw new AppError('validation', 422, violation);

      const row = await createCampaign(db, {
        name: req.body.name,
        sequenceId: req.body.sequence_id,
        tierEffortConfig: req.body.tier_effort_config,
        rampConfig: req.body.ramp_config,
      });
      return toCampaignDto(row, { enrolledCount: 0, contactedCount: 0, manualOnlyCount: 0 });
    },
  );

  r.patch(
    '/campaigns/:id',
    {
      schema: {
        params: idParamSchema,
        body: patchCampaignBodySchema,
        response: { 200: campaignSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      const row = await patchCampaign(db, req.params.id, {
        name: req.body.name,
        status: req.body.status,
      });
      return toCampaignDto(row!, await campaignCounts(db, req.params.id));
    },
  );

  r.delete(
    '/campaigns/:id',
    {
      schema: {
        params: idParamSchema,
        body: deleteCampaignBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const campaign = await requireCampaign(req.params.id);
      if (req.body.confirm.trim() !== campaign.name) {
        throw new AppError('validation', 400, 'confirm must equal the campaign name');
      }
      const result = await deleteCampaignIfUnreferenced(db, campaign.id);
      if (!result.deleted) {
        throw new AppError('conflict', 409, result.reason ?? 'campaign cannot be deleted');
      }
      return { ok: true } as const;
    },
  );

  r.get(
    '/campaigns/:id/capacity',
    { schema: { params: idParamSchema, response: { 200: capacityResponseSchema } } },
    async (req) => {
      await requireCampaign(req.params.id);
      const cap = await capacityToday(enrollDeps, req.params.id);
      return {
        total_daily_capacity: cap.total,
        followups_due_today: cap.followupsDue,
        sent_so_far_today: cap.sentSoFar,
        room_for_new: cap.roomForNew,
        ramp_cap_remaining: cap.rampCap,
        suggested: cap.suggested,
      };
    },
  );

  r.post(
    '/campaigns/:id/enroll',
    {
      schema: {
        params: idParamSchema,
        body: enrollBodySchema,
        response: { 200: enrollResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      const result =
        'count' in req.body
          ? await enroll(enrollDeps, req.params.id, req.body.count)
          : await enrollByIds(enrollDeps, req.params.id, req.body.lead_ids, {
              force: req.body.force,
              allowRecontact: req.body.allow_recontact,
            });
      return toEnrollResponse(result);
    },
  );

  r.get(
    '/campaigns/:id/outcomes',
    { schema: { params: idParamSchema, response: { 200: outcomesResponseSchema } } },
    async (req) => {
      await requireCampaign(req.params.id);
      const rows = await outcomeCounts(db, req.params.id);
      const count = (state: string, sentiment?: string) =>
        rows
          .filter(
            (x) => x.state === state && (sentiment === undefined || x.sentiment === sentiment),
          )
          .reduce((a, x) => a + x.n, 0);
      const replied = count('REPLIED');
      const repliedPositive = count('REPLIED', 'positive');
      return {
        UNSUBSCRIBED: count('UNSUBSCRIBED'),
        BOUNCED: count('BOUNCED'),
        // The public "neutral" bucket is the UI's "neutral/negative"
        // remainder. Untagged replies are terminal replies too and must not
        // disappear from the mutually-exclusive outcome sum.
        REPLIED: { positive: repliedPositive, neutral: replied - repliedPositive },
        COMPLETED: count('COMPLETED'),
        ACTIVE: count('ACTIVE'),
        NEW: count('NEW'),
        total: rows.reduce((a, x) => a + x.n, 0),
      };
    },
  );

  r.post(
    '/campaigns/:id/recycle',
    {
      schema: {
        params: idParamSchema,
        body: recycleBodySchema,
        response: { 200: enrollResponseSchema },
      },
    },
    async (req) => {
      await requireCampaign(req.params.id);
      if (!(await getCampaign(db, req.body.source_campaign_id))) {
        throw AppError.notFound('source campaign');
      }
      try {
        return toEnrollResponse(
          await recycle(enrollDeps, req.params.id, req.body.source_campaign_id),
        );
      } catch (err) {
        // non-draft target refusal is a state conflict (typed errors pass through)
        if (err instanceof Error && err.message.includes('recycle targets a draft campaign')) {
          throw new AppError('conflict', 409, err.message);
        }
        throw err;
      }
    },
  );

  r.get(
    '/cold-storage',
    {
      schema: {
        querystring: coldStorageQuerySchema,
        response: { 200: coldStorageResponseSchema },
      },
    },
    async (req) => {
      if (!(await getCampaign(db, req.query.source_campaign_id))) {
        throw AppError.notFound('campaign');
      }
      const allItems = await coldStorage({ db, clock }, req.query.source_campaign_id);
      const start = (req.query.page - 1) * req.query.per_page;
      const items = allItems.slice(start, start + req.query.per_page);
      return {
        items: items.map((i) => ({
          lead: { id: i.leadId, email: i.email, tier: i.tier },
          completed_at: i.completedAt.toISOString(),
          earliest_recycle_at: i.earliestRecycleAt.toISOString(),
          eligible: i.eligible,
        })),
        total: allItems.length,
        page: req.query.page,
        per_page: req.query.per_page,
      };
    },
  );
}
