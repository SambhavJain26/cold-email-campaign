// Leads + suppression-removal route group (B6.3, docs/10 §Leads & imports).
// Bulk-tier and the list share leadFilterWhere so "select all matching" is
// exact. DELETE /suppressions/:email is deliberately loud (decision U).
import type { FastifyInstance } from 'fastify';
import {
  bulkTierBodySchema,
  bulkTierResponseSchema,
  bulkOutreachStatusBodySchema,
  campaignPersonalizedCopyWriteResponseSchema,
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
  personalizedCopiesResponseSchema,
  personalizedCopySourceWriteResponseSchema,
  personalizedCopyWriteBodySchema,
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
  tierCounts,
  untieredCount,
  updateOutreachStatusByFilter,
  updateOutreachStatusByIds,
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
import {
  clearPersonalizedCopyBlockersForLeadStep,
  createOrReplaceCampaignPersonalizedCopy,
  createOrReplacePersonalizedCopySource,
  getCampaignPersonalizedCopy,
  getPersonalizedCopySource,
  listPersonalizedCopiesForLead,
} from '../db/repos/manualDraftsRepo';
import { getStepByNumber } from '../db/repos/sequencesRepo';
import { contentHashOf } from '../render/hash';

function toLeadDto(
  row: LeadRow,
  latest: LeadListItem['latestEnrollment'],
  pool: LeadListItem['poolAssignment'] = null,
): LeadDto {
  return {
    id: row.id,
    email: row.email,
    first_name: row.firstName,
    last_name: row.lastName,
    company: row.company,
    city: row.city,
    state: row.state,
    tier: row.tier,
    outreach_status: row.outreachStatus,
    is_suppressed: row.isSuppressed,
    custom_fields: (row.customFields ?? {}) as Record<string, string>,
    ...(pool && {
      pool_assignment: {
        campaign_id: pool.campaignId,
        campaign_name: pool.campaignName,
        status: pool.status,
      },
    }),
    ...(latest && {
      latest_enrollment: {
        campaign_id: latest.campaignId,
        campaign_name: latest.campaignName,
        current_state: latest.currentState as EnrollmentState,
        current_step_no: latest.currentStepNo,
        awaiting_completion: latest.awaitingCompletion,
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
const sourceSlotParamsSchema = idParamSchema.extend({ slot: z.coerce.number().int().positive() });
const campaignStepParamsSchema = idParamSchema.extend({
  campaignId: z.coerce.number().int().positive(),
  stepNo: z.coerce.number().int().positive(),
});

function sourceDto(source: Awaited<ReturnType<typeof getPersonalizedCopySource>>) {
  if (!source) throw AppError.notFound('personalized copy source');
  return {
    id: source.id,
    lead_id: source.leadId,
    slot_no: source.slotNo,
    target_step_no: source.targetStepNo,
    subject: source.subject,
    body: source.body,
    status: source.status,
    source_import_id: source.sourceImportId,
    content_hash: contentHashOf(source.subject, source.body),
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString(),
  };
}

type PersonalizedCopiesForLead = Awaited<ReturnType<typeof listPersonalizedCopiesForLead>>;
type ListedCampaignCopy = PersonalizedCopiesForLead['copies'][number];

function campaignCopyDto(row: ListedCampaignCopy) {
  if (!row.step) throw new Error(`personalized copy ${row.copy.id} has no sequence step`);
  return {
    id: row.copy.id,
    lead_id: row.copy.leadId,
    campaign_id: row.copy.campaignId,
    campaign_name: row.campaign.name,
    sequence_step_id: row.step.id,
    step_no: row.copy.stepNo,
    subject: row.copy.subject,
    body: row.copy.body,
    status: row.copy.status,
    source_copy_id: row.copy.sourceCopyId,
    source_import_id: row.copy.sourceImportId,
    content_hash: row.copy.contentHash ?? contentHashOf(row.copy.subject, row.copy.body),
    sent_event_id: row.copy.sentEventId,
    sent_message_id: row.copy.sentMessageId,
    sent_subject: row.sentRenderedSubject,
    created_at: row.copy.createdAt.toISOString(),
    updated_at: row.copy.updatedAt.toISOString(),
    sent_at: row.copy.sentAt?.toISOString() ?? null,
  };
}

export async function leadsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, store } = services;

  r.get(
    '/leads',
    { schema: { querystring: leadsQuerySchema, response: { 200: leadsListResponseSchema } } },
    async (req) => {
      const {
        page,
        per_page,
        tier,
        state,
        campaign_id,
        campaign_scope,
        pool_campaign_id,
        q,
        suppressed,
        outreach_status,
      } = req.query;
      const filter = {
        tier,
        state,
        campaignId: campaign_id,
        campaignScope: campaign_scope,
        poolCampaignId: pool_campaign_id,
        q,
        suppressed,
        outreachStatus: outreach_status,
      };
      const { items, total } = await listLeads(db, filter, page, per_page);
      const counts = await tierCounts(db, filter);
      return {
        items: items.map((i) => toLeadDto(i.lead, i.latestEnrollment, i.poolAssignment)),
        total,
        page,
        per_page,
        untiered_count: await untieredCount(db, filter),
        tier_counts: counts,
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
          outreachStatus: req.body.outreach_status,
          notes: req.body.notes,
          customFields: req.body.custom_fields,
        },
        clock.now(),
      );
      if (!updated || updated.isErased) throw AppError.notFound('lead');
      return toLeadDto(updated, await latestEnrollmentLite(db, updated.id));
    },
  );

  r.get(
    '/leads/:id/personalized-copies',
    {
      schema: {
        params: idParamSchema,
        response: { 200: personalizedCopiesResponseSchema },
      },
    },
    async (req) => {
      const lead = await getLeadById(db, req.params.id);
      if (!lead || lead.isErased) throw AppError.notFound('lead');
      const listed = await listPersonalizedCopiesForLead(db, lead.id);
      return {
        sources: listed.sources.map((source) => sourceDto(source)),
        campaign_copies: listed.copies.map(campaignCopyDto),
      };
    },
  );

  r.put(
    '/leads/:id/personalized-copy-sources/:slot',
    {
      schema: {
        params: sourceSlotParamsSchema,
        body: personalizedCopyWriteBodySchema,
        response: { 200: personalizedCopySourceWriteResponseSchema },
      },
    },
    async (req) => {
      const lead = await getLeadById(db, req.params.id);
      if (!lead || lead.isErased) throw AppError.notFound('lead');
      if (req.body.action === 'copy_from_source') {
        throw new AppError('validation', 400, 'an unassigned source cannot copy from itself');
      }
      const subject = req.body.subject ?? '';
      const body = req.body.body ?? '';
      if (req.body.action === 'mark_ready' && (!subject.trim() || !body.trim())) {
        throw new AppError('validation', 422, 'subject and body are required before marking ready');
      }
      const result = await createOrReplacePersonalizedCopySource(db, {
        leadId: lead.id,
        slotNo: req.params.slot,
        targetStepNo: null,
        sourceImportId: null,
        subject,
        body,
        status: req.body.action === 'mark_ready' ? 'ready' : 'needs_review',
        replace: req.body.replace,
        at: clock.now(),
      });
      return { result: result.result, source: sourceDto(result.source) };
    },
  );

  r.put(
    '/leads/:id/campaigns/:campaignId/steps/:stepNo/personalized-copy',
    {
      schema: {
        params: campaignStepParamsSchema,
        body: personalizedCopyWriteBodySchema,
        response: { 200: campaignPersonalizedCopyWriteResponseSchema },
      },
    },
    async (req) => {
      const lead = await getLeadById(db, req.params.id);
      if (!lead || lead.isErased) throw AppError.notFound('lead');
      const campaign = await getCampaign(db, req.params.campaignId);
      if (!campaign?.sequenceId) throw AppError.notFound('campaign sequence');
      const step = await getStepByNumber(db, campaign.sequenceId, req.params.stepNo);
      if (!step) throw AppError.notFound('sequence step');
      if (step.contentSource !== 'personalized') {
        throw new AppError('conflict', 409, 'the selected sequence step uses template content');
      }
      const existing = await getCampaignPersonalizedCopy(db, lead.id, campaign.id, step.id);
      if (existing?.status === 'sent') {
        throw new AppError('conflict', 409, 'sent personalized copy is immutable');
      }
      const source =
        req.body.action === 'copy_from_source'
          ? await getPersonalizedCopySource(db, lead.id, req.body.source_slot_no)
          : undefined;
      if (req.body.action === 'copy_from_source' && !source) {
        throw AppError.notFound('personalized copy source');
      }
      const subject = source?.subject ?? req.body.subject ?? '';
      const body = source?.body ?? req.body.body ?? '';
      const status =
        req.body.action === 'mark_ready'
          ? ('ready' as const)
          : req.body.action === 'copy_from_source' && source?.status === 'ready'
            ? ('ready' as const)
            : ('needs_review' as const);
      if (status === 'ready' && (!subject.trim() || !body.trim())) {
        throw new AppError('validation', 422, 'subject and body are required before marking ready');
      }
      const result = await createOrReplaceCampaignPersonalizedCopy(db, {
        leadId: lead.id,
        campaignId: campaign.id,
        sequenceStepId: step.id,
        stepNo: step.stepNo,
        sourceCopyId: source?.id ?? existing?.sourceCopyId ?? null,
        sourceImportId: source?.sourceImportId ?? existing?.sourceImportId ?? null,
        subject,
        body,
        contentHash: contentHashOf(subject, body),
        status,
        replace: req.body.replace,
        at: clock.now(),
      });
      if (status === 'ready') {
        await clearPersonalizedCopyBlockersForLeadStep(db, lead.id, campaign.id, step.id);
      }
      const listed = await listPersonalizedCopiesForLead(db, lead.id);
      const saved = listed.copies.find(
        (row) => row.copy.campaignId === campaign.id && row.step?.id === step.id,
      );
      if (!saved) throw new Error('saved personalized copy not found');
      return { result, copy: campaignCopyDto(saved) };
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
              campaignScope: req.body.filter.campaign_scope,
              poolCampaignId: req.body.filter.pool_campaign_id,
              q: req.body.filter.q,
              suppressed: req.body.filter.suppressed,
              outreachStatus: req.body.filter.outreach_status,
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

  r.post(
    '/leads/bulk-outreach-status',
    { schema: { body: bulkOutreachStatusBodySchema, response: { 200: bulkTierResponseSchema } } },
    async (req) => {
      const hasIds = (req.body.lead_ids?.length ?? 0) > 0;
      const hasFilter = req.body.filter !== undefined;
      if (hasIds === hasFilter) {
        throw new AppError('validation', 400, 'provide exactly one of lead_ids or filter');
      }
      const updated = hasIds
        ? await updateOutreachStatusByIds(db, req.body.lead_ids!, req.body.outreach_status)
        : await updateOutreachStatusByFilter(
            db,
            {
              tier: req.body.filter!.tier,
              state: req.body.filter!.state,
              campaignId: req.body.filter!.campaign_id,
              campaignScope: req.body.filter!.campaign_scope,
              poolCampaignId: req.body.filter!.pool_campaign_id,
              q: req.body.filter!.q,
              suppressed: req.body.filter!.suppressed,
              outreachStatus: req.body.filter!.outreach_status,
            },
            req.body.outreach_status,
          );
      return { updated };
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
