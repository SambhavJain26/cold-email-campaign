// Unibox + enrollment actions + manual-sends (B6.7/B6.8, docs/10 §Unibox).
// Sentiment tagging appends `sentiment_tagged` (decision M — never an UPDATE);
// manual unsubscribe appends `unsubscribe(source=manual)` whose suppression
// side effect fires inside the eventStore chokepoint; snooze is a scheduling
// patch, deliberately NO event (docs/10 traceability).
import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  createReminderBodySchema,
  dispositionReplyBodySchema,
  manualComposePrefillSchema,
  manualDraftSchema,
  manualSendBodySchema,
  manualSendResponseSchema,
  okResponseSchema,
  patchReminderBodySchema,
  patchManualDraftBodySchema,
  reminderListResponseSchema,
  reminderQuerySchema,
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
import {
  FatalChecksError,
  MailboxUnhealthyError,
  manualComposePrefill,
  manualSend,
} from '../services/manualCompose';
import { buildEvent } from '../domain/events';
import type { DomainEvent } from '../domain/events';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';
import {
  createReminder,
  dismissNotNowReminder,
  getReminder,
  listReminders,
  patchReminder,
  upsertNotNowReminder,
  type ReminderListRow,
} from '../db/repos/remindersRepo';
import { getSettings } from '../db/repos/settingsRepo';
import {
  getManualDraft,
  patchManualDraft as updateManualDraft,
  type ManualDraftRow,
} from '../db/repos/manualDraftsRepo';

function toManualDraftDto(row: ManualDraftRow) {
  return {
    id: row.id,
    lead_id: row.leadId,
    campaign_id: row.campaignId,
    step_no: 1 as const,
    source_import_id: row.sourceImportId,
    subject: row.subject,
    body: row.body,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    sent_at: row.sentAt?.toISOString() ?? null,
  };
}

function calendarDateInZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function toReminderDto(row: ReminderListRow) {
  const name = [row.leadFirstName, row.leadLastName].filter(Boolean).join(' ') || row.leadEmail;
  return {
    id: row.id,
    enrollment_id: row.enrollmentId,
    incoming_message_id: row.incomingMessageId,
    due_date: row.dueDate,
    note: row.note,
    source: row.source,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    completed_at: row.completedAt?.toISOString() ?? null,
    lead: { id: row.leadId, name, company: row.leadCompany },
    campaign_id: row.campaignId,
    reply_snippet: row.replySnippet,
  };
}

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
    disposition: row.disposition as UniboxItemDto['disposition'],
    recontact_after: row.recontactAfter?.slice(0, 10) ?? null,
    auto_unsubscribed: row.autoUnsubscribed,
    lead_suppressed: row.leadSuppressed,
    sequence_continues: row.enrollmentState === 'ACTIVE' || row.enrollmentState === 'NEW',
    meeting_booked: row.meetingBooked,
    enrollment_id: row.enrollmentId,
  };
}

export async function uniboxRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, store, scheduler, renderer, sequences } = services;

  r.get(
    '/reminders',
    {
      schema: {
        querystring: reminderQuerySchema,
        response: { 200: reminderListResponseSchema },
      },
    },
    async (req) => {
      const settings = await getSettings(db);
      const today = calendarDateInZone(clock.now(), settings.defaultTimezone);
      const result = await listReminders(db, {
        today,
        view: req.query.view,
        status: req.query.status,
        page: req.query.page,
        perPage: req.query.per_page,
      });
      return {
        items: result.items.map(toReminderDto),
        total: result.total,
        page: req.query.page,
        per_page: req.query.per_page,
        open_count: result.openCount,
      };
    },
  );

  r.post(
    '/unibox/:id/reminders',
    {
      schema: {
        params: idParamSchema,
        body: createReminderBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      const row = await getUniboxRow(db, req.params.id);
      if (!row) throw AppError.notFound('unibox item');
      const settings = await getSettings(db);
      const today = calendarDateInZone(clock.now(), settings.defaultTimezone);
      if (req.body.due_date < today) {
        throw new AppError('validation', 400, 'reminder due_date cannot be in the past');
      }
      await createReminder(db, {
        enrollmentId: row.enrollmentId,
        incomingMessageId: row.incomingMessageId,
        dueDate: req.body.due_date,
        note: req.body.note,
        source: 'manual',
        at: clock.now(),
      });
      return { ok: true } as const;
    },
  );

  r.patch(
    '/reminders/:id',
    {
      schema: {
        params: idParamSchema,
        body: patchReminderBodySchema,
        response: { 200: okResponseSchema },
      },
    },
    async (req) => {
      if (!(await getReminder(db, req.params.id))) throw AppError.notFound('reminder');
      if (req.body.due_date !== undefined) {
        const settings = await getSettings(db);
        const today = calendarDateInZone(clock.now(), settings.defaultTimezone);
        if (req.body.due_date < today) {
          throw new AppError('validation', 400, 'reminder due_date cannot be in the past');
        }
      }
      await patchReminder(
        db,
        req.params.id,
        {
          ...(req.body.due_date !== undefined && { dueDate: req.body.due_date }),
          ...(req.body.note !== undefined && { note: req.body.note }),
          ...(req.body.status !== undefined && { status: req.body.status }),
        },
        clock.now(),
      );
      return { ok: true } as const;
    },
  );

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
      // Clicking the already-selected tag is not a new operator fact. Keep
      // the append-only ledger meaningful and make retries safe after a slow
      // response or lost connection.
      if (row.effectiveSentiment === req.body.sentiment) {
        return toUniboxItemDto(row);
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
    '/unibox/:id/disposition',
    {
      schema: {
        params: idParamSchema,
        body: dispositionReplyBodySchema,
        response: { 200: uniboxItemSchema },
      },
    },
    async (req) => {
      const row = await getUniboxRow(db, req.params.id);
      if (!row) throw AppError.notFound('unibox item');
      if (row.replyEventId === null) {
        throw new AppError('conflict', 409, 'only human replies can be dispositioned');
      }
      const recontactAfter = req.body.recontact_after ?? null;
      const storedRecontactAfter = row.recontactAfter?.slice(0, 10) ?? null;
      const now = clock.now();
      const settings = await getSettings(db);
      if (
        recontactAfter !== null &&
        recontactAfter <= calendarDateInZone(now, settings.defaultTimezone)
      ) {
        throw new AppError('validation', 400, 'recontact_after must be a future calendar date');
      }
      if (
        row.disposition === req.body.disposition &&
        storedRecontactAfter === recontactAfter &&
        req.body.disposition !== 'not_now'
      ) {
        return toUniboxItemDto(row);
      }

      const events: DomainEvent[] = [
        buildEvent.replyDispositioned({
          leadId: row.leadId,
          enrollmentId: row.enrollmentId,
          campaignId: row.campaignId,
          occurredAt: clock.now(),
          attributes: {
            reply_event_id: row.replyEventId,
            incoming_message_id: row.incomingMessageId,
            disposition: req.body.disposition,
            ...(recontactAfter === null ? {} : { recontact_after: recontactAfter }),
            dispositioned_by: 'human',
          },
        }),
      ];
      const suppressive = ['not_interested', 'wrong_person', 'explicit_unsubscribe'].includes(
        req.body.disposition,
      );
      if (!row.leadSuppressed && suppressive) {
        events.push(
          buildEvent.unsubscribe({
            leadId: row.leadId,
            enrollmentId: row.enrollmentId,
            campaignId: row.campaignId,
            source: 'manual',
            occurredAt: clock.now(),
          }),
        );
      }
      await store.append(events, {
        txWork: async (tx) => {
          if (req.body.disposition === 'not_now') {
            await upsertNotNowReminder(tx, {
              enrollmentId: row.enrollmentId,
              incomingMessageId: row.incomingMessageId,
              dueDate: recontactAfter!,
              at: now,
            });
          } else {
            await dismissNotNowReminder(tx, row.incomingMessageId, now);
          }
        },
      });
      return toUniboxItemDto((await getUniboxRow(db, req.params.id))!);
    },
  );

  r.get(
    '/enrollments/:id/manual-compose-prefill',
    {
      schema: { params: idParamSchema, response: { 200: manualComposePrefillSchema } },
    },
    async (req) => {
      try {
        const result = await manualComposePrefill({ db, renderer }, req.params.id);
        return {
          enrollment_id: result.enrollmentId,
          lead_id: result.leadId,
          campaign: result.campaign,
          step_no: result.stepNo,
          step_count: result.stepCount,
          due_at: result.dueAt?.toISOString() ?? null,
          personalization_mode: result.personalizationMode,
          subject: result.subject,
          body: result.body,
          variant_id: result.variantId,
          draft_id: result.draftId,
          draft_status: result.draftStatus,
          draft_source_import_id: result.draftSourceImportId,
          thread: {
            assigned_mailbox_id: result.thread.assignedMailboxId,
            previous_message_ids: result.thread.previousMessageIds,
            in_thread: result.thread.inThread,
          },
          checks: result.checks,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          throw AppError.notFound('enrollment');
        }
        if (error instanceof Error) throw new AppError('conflict', 409, error.message);
        throw error;
      }
    },
  );

  r.get(
    '/manual-drafts/:id',
    { schema: { params: idParamSchema, response: { 200: manualDraftSchema } } },
    async (req) => {
      const draft = await getManualDraft(db, req.params.id);
      if (!draft) throw AppError.notFound('manual draft');
      return toManualDraftDto(draft);
    },
  );

  r.patch(
    '/manual-drafts/:id',
    {
      schema: {
        params: idParamSchema,
        body: patchManualDraftBodySchema,
        response: { 200: manualDraftSchema },
      },
    },
    async (req) => {
      const existing = await getManualDraft(db, req.params.id);
      if (!existing) throw AppError.notFound('manual draft');
      if (existing.status === 'sent') {
        throw new AppError('conflict', 409, 'sent drafts are immutable');
      }
      const draft = await updateManualDraft(db, req.params.id, {
        subject: req.body.subject,
        body: req.body.body,
        status:
          req.body.status ??
          (req.body.subject !== undefined || req.body.body !== undefined
            ? 'needs_review'
            : undefined),
      });
      return toManualDraftDto(draft!);
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
      if (e.currentState !== 'ACTIVE') {
        throw new AppError(
          'conflict',
          409,
          'Snooze is retained only for active legacy scheduling; use a reminder for replies',
        );
      }
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
            enrollmentId: req.body.enrollment_id,
            draftId: req.body.draft_id,
            mailboxId: req.body.mailbox_id,
            subject: req.body.subject,
            bodyText: req.body.body,
            allowRecontact: req.body.allow_recontact,
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
