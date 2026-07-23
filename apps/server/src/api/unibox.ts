// Unibox + enrollment actions + manual-sends (B6.7/B6.8, docs/10 §Unibox).
// Sentiment tagging appends `sentiment_tagged` (decision M — never an UPDATE);
// manual unsubscribe appends `unsubscribe(source=manual)` whose suppression
// side effect fires inside the eventStore chokepoint; snooze is a scheduling
// patch, deliberately NO event (docs/10 traceability).
import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  manualSendBodySchema,
  manualSendResponseSchema,
  okResponseSchema,
  snoozeBodySchema,
  tagSentimentBodySchema,
  uniboxDetailResponseSchema,
  uniboxItemSchema,
  uniboxListResponseSchema,
  uniboxQuerySchema,
  type UniboxItemDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { getUniboxRow, listUnibox, type UniboxRow } from '../db/repos/incomingMessagesRepo';
import { getById, patchScheduling } from '../db/repos/enrollmentsRepo';
import { listThreadMessageIds } from '../db/repos/sentMessagesRepo';
import { FatalChecksError, MailboxUnhealthyError, manualSend } from '../services/manualCompose';
import { buildEvent } from '../domain/events';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toUniboxItemDto(row: UniboxRow): UniboxItemDto {
  const name = [row.leadFirstName, row.leadLastName].filter(Boolean).join(' ') || row.leadEmail;
  return {
    incoming_message_id: row.incomingMessageId,
    received_at: row.receivedAt,
    lead: { id: row.leadId, name, company: row.leadCompany },
    campaign_id: row.campaignId,
    step_no: row.stepNo,
    snippet: row.snippet,
    effective_sentiment: row.effectiveSentiment as UniboxItemDto['effective_sentiment'],
    suggested_sentiment: row.suggestedSentiment as UniboxItemDto['suggested_sentiment'],
    auto_unsubscribed: row.autoUnsubscribed,
    meeting_booked: row.meetingBooked,
    enrollment_id: row.enrollmentId,
  };
}

export async function uniboxRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, store, scheduler, renderer, sequences } = services;

  r.get(
    '/unibox',
    { schema: { querystring: uniboxQuerySchema, response: { 200: uniboxListResponseSchema } } },
    async (req) => {
      const { page, per_page, bucket, sentiment, mailbox_id, unhandled } = req.query;
      const { items, total } = await listUnibox(db, {
        bucket,
        sentiment,
        mailboxId: mailbox_id,
        unhandled,
        page,
        perPage: per_page,
      });
      return { items: items.map(toUniboxItemDto), total, page, per_page };
    },
  );

  r.get(
    '/unibox/:id',
    { schema: { params: idParamSchema, response: { 200: uniboxDetailResponseSchema } } },
    async (req) => {
      const row = await getUniboxRow(db, req.params.id);
      if (!row) throw AppError.notFound('unibox item');
      const thread = await listThreadMessageIds(db, row.enrollmentId);
      return {
        ...toUniboxItemDto(row),
        body_text: row.bodyText ?? row.snippet,
        thread: thread.map((t) => ({
          message_id: t.messageId,
          step_no: t.stepNo,
          sent_at: t.sentAt.toISOString(),
        })),
      };
    },
  );

  r.post(
    '/unibox/:id/sentiment',
    {
      schema: {
        params: idParamSchema,
        body: tagSentimentBodySchema,
        response: { 200: uniboxItemSchema },
      },
    },
    async (req) => {
      const row = await getUniboxRow(db, req.params.id);
      if (!row) throw AppError.notFound('unibox item');
      if (row.replyEventId === null) {
        throw new AppError('conflict', 409, 'only human replies can be sentiment-tagged');
      }
      await store.append([
        buildEvent.sentimentTagged({
          leadId: row.leadId,
          enrollmentId: row.enrollmentId,
          campaignId: row.campaignId,
          sentiment: req.body.sentiment,
          occurredAt: clock.now(),
          attributes: { reply_event_id: row.replyEventId, tagged_by: 'human' },
        }),
      ]);
      return toUniboxItemDto((await getUniboxRow(db, req.params.id))!);
    },
  );

  r.post(
    '/enrollments/:id/meeting-booked',
    { schema: { params: idParamSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const e = await getById(db, req.params.id);
      if (!e) throw AppError.notFound('enrollment');
      await store.append([
        buildEvent.meetingBooked({
          leadId: e.leadId,
          enrollmentId: e.id,
          campaignId: e.campaignId,
          occurredAt: clock.now(),
        }),
      ]);
      return { ok: true } as const;
    },
  );

  r.post(
    '/enrollments/:id/snooze',
    {
      schema: {
        params: idParamSchema,
        body: snoozeBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const e = await getById(db, req.params.id);
      if (!e) throw AppError.notFound('enrollment');
      await patchScheduling(db, e.id, { snoozedUntil: new Date(req.body.until) });
      return { ok: true } as const;
    },
  );

  r.post(
    '/enrollments/:id/unsubscribe',
    { schema: { params: idParamSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const e = await getById(db, req.params.id);
      if (!e) throw AppError.notFound('enrollment');
      await store.append([
        buildEvent.unsubscribe({
          leadId: e.leadId,
          enrollmentId: e.id,
          campaignId: e.campaignId,
          source: 'manual',
          occurredAt: clock.now(),
        }),
      ]);
      return { ok: true } as const;
    },
  );

  r.post(
    '/manual-sends',
    { schema: { body: manualSendBodySchema, response: { 200: manualSendResponseSchema } } },
    async (req) => {
      let result;
      try {
        result = await manualSend(
          { db, clock, scheduler, renderer, store, sequences },
          {
            leadId: req.body.lead_id,
            campaignId: req.body.campaign_id,
            mailboxId: req.body.mailbox_id,
            subject: req.body.subject,
            bodyText: req.body.body,
          },
        );
      } catch (err) {
        // typed errors (mailbox_unhealthy 409, fatal checks 422) pass through
        if (err instanceof MailboxUnhealthyError || err instanceof FatalChecksError) throw err;
        if (err instanceof Error && err.message.includes('not found')) {
          throw new AppError('not_found', 404, err.message);
        }
        // remaining service refusals are state conflicts: suppressed lead,
        // non-ACTIVE/wrong-mode enrollment, recycle guard, reroute attempt
        if (err instanceof Error) throw new AppError('conflict', 409, err.message);
        throw err;
      }
      if (result.outcome !== 'sent' || result.messageId === null) {
        // transient SMTP failure / instant RCPT rejection — the send did not land
        throw new AppError(
          result.outcome === 'transient' || result.outcome === 'auth_failed'
            ? 'mailbox_unhealthy'
            : 'conflict',
          409,
          `manual send did not complete: ${result.outcome}`,
        );
      }
      return {
        enrollment_id: result.enrollmentId,
        message_id: result.messageId,
        checks: result.checks,
      };
    },
  );
}
