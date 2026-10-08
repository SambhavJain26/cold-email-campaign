import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  incomingRowsQuerySchema,
  incomingRowsResponseSchema,
  incomingMessageSchema,
  incomingMessageListSchema,
  incomingContextSchema,
  reviewActionSchema,
  reviewMutationSchema,
  incomingLinkSchema,
  incomingAuthorshipBodySchema,
  incomingAckSchema,
  incomingRetentionSchema,
  okResponseSchema,
  idParamSchema,
  pageQuerySchema,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import type { ZodTypeProvider } from './plugins/zodCompilers';
import { AppError } from './errors';
import {
  listRows,
  messageIdsForRow,
  readMessage,
  needsLinking,
  sentContext,
  linkCandidates,
  setRetention,
  rowHistory,
} from '../db/repos/incomingReviewRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { senderIdentity } from '../poller/companyStop';
import { deleteStoredContent, recoverStoredContent } from '../services/incomingContent';
import { getById } from '../db/repos/enrollmentsRepo';
import {
  reviewPoolLead,
  applyReviewAction,
  linkIncoming,
  confirmAuthorship,
  acknowledgeIncoming,
  markUnrelated,
  suppressLinkedAddress,
} from '../services/incomingReviewActions';

export async function incomingReviewRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, store, clock } = services;
  r.post(
    '/unibox/lead-action',
    {
      schema: {
        body: reviewActionSchema.extend({
          lead_id: z.number().int().positive(),
          campaign_id: z.number().int().positive(),
        }),
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      await reviewPoolLead(
        db,
        store,
        req.body.lead_id,
        req.body.campaign_id,
        req.body,
        clock.now(),
      );
      return { ok: true } as const;
    },
  );
  r.post(
    '/unibox/messages/:id/recover-content',
    {
      schema: {
        params: idParamSchema,
        body: reviewMutationSchema.strict(),
        response: { 200: incomingMessageSchema },
      },
    },
    async (req) => {
      await recoverStoredContent(db, services.transport, req.params.id, req.body, clock.now());
      return (await readMessage(db, req.params.id))!;
    },
  );
  r.post(
    '/unibox/messages/:id/suppress-address',
    {
      schema: {
        params: idParamSchema,
        body: reviewMutationSchema
          .extend({ lead_id: z.number().int().positive(), confirm: z.string() })
          .strict(),
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      await suppressLinkedAddress(db, store, req.params.id, req.body, clock.now());
      return { ok: true } as const;
    },
  );
  r.get(
    '/unibox/retention',
    { schema: { response: { 200: incomingRetentionSchema } } },
    async () => ({ days: (await getSettings(db)).incomingContentRetentionDays }),
  );
  r.put(
    '/unibox/retention',
    { schema: { body: incomingRetentionSchema, response: { 200: incomingRetentionSchema } } },
    async (req) => {
      await setRetention(db, req.body.days);
      return req.body;
    },
  );
  r.delete(
    '/unibox/messages/:id/content',
    {
      schema: {
        params: idParamSchema,
        body: reviewMutationSchema.strict(),
        response: { 200: incomingMessageSchema },
      },
    },
    async (req) => {
      await deleteStoredContent(
        db,
        req.params.id,
        req.body,
        clock.now(),
        services.config.INCOMING_DELETION_MANIFEST_PATH,
      );
      return (await readMessage(db, req.params.id))!;
    },
  );
  r.get(
    '/unibox/rows',
    {
      schema: {
        querystring: incomingRowsQuerySchema,
        response: { 200: incomingRowsResponseSchema },
      },
    },
    async (req) => ({
      ...(await listRows(db, { ...req.query, now: clock.now() })),
      page: req.query.page,
      per_page: req.query.per_page,
    }),
  );
  r.get(
    '/unibox/rows/:id/messages',
    { schema: { params: idParamSchema, response: { 200: incomingContextSchema } } },
    async (req) => {
      const e = await getById(db, req.params.id);
      if (!e) throw AppError.notFound('Enrollment');
      const ids = await messageIdsForRow(db, e.leadId, e.campaignId);
      return {
        row:
          (
            await listRows(db, {
              lead_id: e.leadId,
              campaign_id: e.campaignId,
              view: 'all',
              page: 1,
              per_page: 1,
              now: clock.now(),
            })
          ).items[0] ?? null,
        messages: (
          await Promise.all(ids.map((id) => readMessage(db, id, e.campaignId, e.leadId, false)))
        ).filter((m) => m !== null),
        sent: await sentContext(db, e.id),
        history: await rowHistory(db, e.id),
      };
    },
  );
  r.get(
    '/unibox/lead-messages',
    {
      schema: {
        querystring: z.object({
          lead_id: z.coerce.number().positive(),
          campaign_id: z.coerce.number().positive(),
        }),
        response: { 200: incomingContextSchema },
      },
    },
    async (req) => {
      const ids = await messageIdsForRow(db, req.query.lead_id, req.query.campaign_id);
      return {
        row:
          (
            await listRows(db, {
              lead_id: req.query.lead_id,
              campaign_id: req.query.campaign_id,
              view: 'all',
              page: 1,
              per_page: 1,
              now: clock.now(),
            })
          ).items[0] ?? null,
        messages: (
          await Promise.all(
            ids.map((id) => readMessage(db, id, req.query.campaign_id, req.query.lead_id, false)),
          )
        ).filter((m) => m !== null),
        sent: [],
        history: [],
      };
    },
  );
  r.get(
    '/unibox/needs-linking',
    {
      schema: {
        querystring: pageQuerySchema.extend({
          view: z.enum(['needs_review', 'all', 'acknowledged']).default('needs_review'),
        }),
        response: { 200: incomingMessageListSchema },
      },
    },
    async (req) => ({
      ...(await needsLinking(db, req.query.page, req.query.per_page, req.query.view)),
      page: req.query.page,
      per_page: req.query.per_page,
    }),
  );
  r.get(
    '/unibox/link-candidates',
    {
      schema: {
        querystring: z.object({
          campaign_id: z.coerce.number().positive(),
          search: z.string().max(200).default(''),
          company_sender: z.email().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                lead_id: z.number(),
                enrollment_id: z.number().nullable(),
                name: z.string(),
                email: z.string(),
                company: z.string().nullable(),
                state: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => ({
      items: await linkCandidates(
        db,
        req.query.campaign_id,
        req.query.company_sender
          ? (senderIdentity(req.query.company_sender).company ?? req.query.company_sender)
          : req.query.search,
      ),
    }),
  );
  r.get(
    '/unibox/messages/:id',
    { schema: { params: idParamSchema, response: { 200: incomingMessageSchema } } },
    async (req) => {
      const m = await readMessage(db, req.params.id);
      if (!m) throw AppError.notFound('Incoming message');
      return m;
    },
  );
  r.post(
    '/unibox/rows/:id/action',
    {
      schema: {
        params: idParamSchema,
        body: reviewActionSchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      await applyReviewAction(db, store, req.params.id, req.body, clock.now());
      return { ok: true } as const;
    },
  );
  r.post(
    '/unibox/messages/:id/link',
    {
      schema: {
        params: idParamSchema,
        body: incomingLinkSchema,
        response: { 200: incomingMessageSchema },
      },
    },
    async (req) => {
      await linkIncoming(db, store, req.params.id, req.body, clock.now());
      return (await readMessage(db, req.params.id))!;
    },
  );
  r.post(
    '/unibox/messages/:id/unrelated',
    {
      schema: {
        params: idParamSchema,
        body: reviewMutationSchema.strict(),
        response: { 200: incomingMessageSchema },
      },
    },
    async (req) => {
      await markUnrelated(db, req.params.id, req.body, clock.now());
      return (await readMessage(db, req.params.id))!;
    },
  );
  r.post(
    '/unibox/messages/:id/authorship',
    {
      schema: {
        params: idParamSchema,
        body: incomingAuthorshipBodySchema,
        response: { 200: incomingMessageSchema },
      },
    },
    async (req) => {
      await confirmAuthorship(db, store, req.params.id, req.body, clock.now());
      return (await readMessage(db, req.params.id))!;
    },
  );
  r.post(
    '/unibox/acknowledgements',
    { schema: { body: incomingAckSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      await acknowledgeIncoming(db, req.body, clock.now());
      return { ok: true } as const;
    },
  );
}
