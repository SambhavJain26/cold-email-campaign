// Leads + suppression-removal route group (B6.3, docs/10 §Leads & imports).
// Bulk-tier and the list share leadFilterWhere so "select all matching" is
// exact. DELETE /suppressions/:email is deliberately loud (decision U).
import type { FastifyInstance } from 'fastify';
import {
  bulkTierBodySchema,
  bulkTierResponseSchema,
  deleteSuppressionBodySchema,
  eraseLeadBodySchema,
  idParamSchema,
  leadDetailResponseSchema,
  leadSchema,
  leadsListResponseSchema,
  createLeadBodySchema,
  createLeadResponseSchema,
  leadsQuerySchema,
  okResponseSchema,
  patchLeadBodySchema,
  type EventViewDto,
  type LeadDto,
} from '@coldemail/shared';
import { z } from 'zod';
import type { AppServices } from '../composition';
import type { EnrollmentState } from '@coldemail/shared';
import {
  getLeadById,
  anonymizeLeadPii,
  latestEnrollmentLite,
  listLeads,
  patchLead,
  untieredCount,
  type LeadListItem,
  type LeadRow,
} from '../db/repos/leadsRepo';
import { listRowsByLead, type EventRow } from '../db/repos/eventsRepo';
import { removeSuppression } from '../db/repos/suppressionsRepo';
import { redactAlertsContaining } from '../db/repos/alertsRepo';
import { listForLead } from '../db/repos/enrollmentsRepo';
import { getCampaign } from '../db/repos/campaignsRepo';
import { buildEvent } from '../domain/events';
import { insertAlert } from '../db/repos/alertsRepo';
import { bulkTier } from '../services/tiering';
import { createSingleLead } from '../ingest/service';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toLeadDto(row: LeadRow, latest: LeadListItem['latestEnrollment']): LeadDto {
  return {
    id: row.id,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
    company: row.company,
    city: row.city,
    state: row.state,
    tier: row.tier,
    is_suppressed: row.isSuppressed,
    custom_fields: (row.customFields ?? {}) as Record<string, string>,
    ...(latest && {
      latest_enrollment: {
        campaign_id: latest.campaignId,
        campaign_name: latest.campaignName,
        current_state: latest.currentState as EnrollmentState,
        current_step_no: latest.currentStepNo,
      },
    }),
  };
}

function toEventView(row: EventRow): EventViewDto {
  return {
    id: row.id,
    type: row.type,
    occurred_at: row.occurredAt.toISOString(),
    campaign_id: row.campaignId,
    enrollment_id: row.enrollmentId,
    step_no: row.stepNo,
    mailbox_id: row.mailboxId,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
  };
}

const suppressionParamsSchema = z.object({ email: z.string() });

export async function leadsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, store } = services;

  r.get(
    '/leads',
    { schema: { querystring: leadsQuerySchema, response: { 200: leadsListResponseSchema } } },
    async (req) => {
      const { page, per_page, tier, state, campaign_id, q, suppressed } = req.query;
      const { items, total } = await listLeads(
        db,
        { tier, state, campaignId: campaign_id, q, suppressed },
        page,
        per_page,
      );
      return {
        items: items.map((i) => toLeadDto(i.lead, i.latestEnrollment)),
        total,
        page,
        per_page,
        untiered_count: await untieredCount(db),
      };
    },
  );

  // Finding 10. Runs the SAME preview+commit as a CSV upload rather than
  // inserting directly, so hygiene, dedup and the commit-time suppression
  // re-check are provably identical to the bulk path. Costs one imports row.
  r.post(
    '/leads',
    { schema: { body: createLeadBodySchema, response: { 200: createLeadResponseSchema } } },
    async (req) => createSingleLead({ db }, req.body),
  );

  r.get(
    '/leads/:id',
    { schema: { params: idParamSchema, response: { 200: leadDetailResponseSchema } } },
    async (req) => {
      const row = await getLeadById(db, req.params.id);
      if (!row || row.isErased) throw AppError.notFound('lead');
      const timeline = await listRowsByLead(db, row.id);
      const manualSendable = (
        await Promise.all(
          (await listForLead(db, row.id)).map(async (enrollment) => {
            if (
              enrollment.currentState !== 'ACTIVE' ||
              enrollment.personalizationMode !== 'human_written'
            ) {
              return null;
            }
            const campaign = await getCampaign(db, enrollment.campaignId);
            return campaign?.status === 'active'
              ? {
                  enrollment_id: enrollment.id,
                  campaign_id: campaign.id,
                  campaign_name: campaign.name,
                }
              : null;
          }),
        )
      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      return {
        ...toLeadDto(row, await latestEnrollmentLite(db, row.id)),
        notes: row.notes,
        timeline: timeline.map(toEventView),
        manual_sendable_enrollments: manualSendable,
      };
    },
  );

  r.patch(
    '/leads/:id',
    {
      schema: {
        params: idParamSchema,
        body: patchLeadBodySchema,
        response: { 200: leadSchema },
      },
    },
    async (req) => {
      const updated = await patchLead(
        db,
        req.params.id,
        {
          tier: req.body.tier,
          notes: req.body.notes,
          customFields: req.body.custom_fields,
        },
        clock.now(),
      );
      if (!updated || updated.isErased) throw AppError.notFound('lead');
      return toLeadDto(updated, await latestEnrollmentLite(db, updated.id));
    },
  );

  r.post(
    '/leads/bulk-tier',
    { schema: { body: bulkTierBodySchema, response: { 200: bulkTierResponseSchema } } },
    async (req) => {
      try {
        return await bulkTier(
          { db },
          {
            leadIds: req.body.lead_ids,
            filter: req.body.filter && {
              tier: req.body.filter.tier,
              state: req.body.filter.state,
              campaignId: req.body.filter.campaign_id,
              q: req.body.filter.q,
              suppressed: req.body.filter.suppressed,
            },
            tier: req.body.tier,
          },
        );
      } catch (err) {
        // service refusals (exactly-one-of, empty filter) are caller mistakes
        throw new AppError('validation', 400, (err as Error).message);
      }
    },
  );

  r.delete(
    '/suppressions/:email',
    {
      schema: {
        params: suppressionParamsSchema,
        body: deleteSuppressionBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const email = req.params.email.trim().toLowerCase();
      if (req.body.confirm.trim().toLowerCase() !== email) {
        throw new AppError('validation', 400, 'confirm must equal the email being removed');
      }
      const removed = await removeSuppression(db, email, clock.now());
      if (!removed) throw AppError.notFound('suppression');
      // decision U: audit-logged as an alert row
      await insertAlert(db, 'suppression_removed', 'warning', { email });
      return { ok: true } as const;
    },
  );

  r.post(
    '/leads/:id/erase',
    {
      schema: {
        params: idParamSchema,
        body: eraseLeadBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const lead = await getLeadById(db, req.params.id);
      if (!lead || lead.isErased) throw AppError.notFound('lead');
      if (req.body.confirm.trim().toLowerCase() !== lead.email) {
        throw new AppError('validation', 400, 'confirm must equal the current email');
      }
      const enrollmentsForLead = await listForLead(db, lead.id);
      const now = clock.now();
      const active = enrollmentsForLead.filter(
        (e) => e.currentState === 'ACTIVE' || e.currentState === 'NEW',
      );
      if (active.length > 0) {
        await store.append(
          active.map((e) =>
            buildEvent.unsubscribe({
              leadId: lead.id,
              enrollmentId: e.id,
              campaignId: e.campaignId,
              occurredAt: now,
              source: 'manual',
              attributes: { data_erasure: true },
            }),
          ),
        );
      }
      await removeSuppression(db, lead.email, now).catch(() => undefined);
      const ids = enrollmentsForLead.map((e) => e.id);
      // Alert payloads are operator-visible.  Any payload containing the old
      // address is replaced by a non-identifying lineage reference.
      await redactAlertsContaining(db, lead.email, lead.id);
      await anonymizeLeadPii(db, { leadId: lead.id, enrollmentIds: ids, at: now });
      await insertAlert(db, 'lead_erased', 'warning', { lead_id: lead.id });
      return { ok: true } as const;
    },
  );
}
