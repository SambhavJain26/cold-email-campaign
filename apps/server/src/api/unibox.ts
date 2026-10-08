// Unibox + enrollment actions (B6.7/B6.8, docs/10 §Unibox).
// Sentiment tagging appends `sentiment_tagged` (decision M — never an UPDATE);
// Legacy sending mutations are retired in favor of confirmed review actions.
import type { FastifyInstance } from 'fastify';
import {
  idParamSchema,
  createReminderBodySchema,
  okResponseSchema,
  patchReminderBodySchema,
  reminderListResponseSchema,
  reminderQuerySchema,
  tagSentimentBodySchema,
  uniboxDetailResponseSchema,
  uniboxItemSchema,
  uniboxListResponseSchema,
  uniboxQuerySchema,
  type UniboxItemDto,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import { getUniboxRow, listUnibox, type UniboxRow } from '../db/repos/incomingMessagesRepo';
import { getById } from '../db/repos/enrollmentsRepo';
import { listThreadMessageIds } from '../db/repos/sentMessagesRepo';
import { buildEvent } from '../domain/events';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';
import {
  createReminder,
  getReminder,
  listReminders,
  patchReminder,
  type ReminderListRow,
} from '../db/repos/remindersRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { hasConfirmedHumanReply } from '../db/repos/metricsRepo';

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
  const { db, clock, store } = services;

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

  r.post('/unibox/:id/disposition', { schema: { params: idParamSchema } }, async () => {
    throw new AppError(
      'conflict',
      410,
      'Reply dispositions are retired. Use explicit Continue, Stop sequence, Suppress address, or Delay.',
    );
  });

  r.get(
    '/enrollments/:id/manual-compose-prefill',
    { schema: { params: idParamSchema } },
    async () => {
      throw new AppError(
        'conflict',
        410,
        'manual compose prefill is retired; use lead Personalized Copy and sequence steps',
      );
    },
  );

  r.get('/manual-drafts/:id', { schema: { params: idParamSchema } }, async () => {
    throw new AppError(
      'conflict',
      410,
      'manual drafts are retired; use the personalized-copy source or campaign-step APIs',
    );
  });

  r.patch(
    '/manual-drafts/:id',
    {
      schema: { params: idParamSchema },
    },
    async () => {
      throw new AppError(
        'conflict',
        410,
        'manual drafts are retired; use the personalized-copy source or campaign-step APIs',
      );
    },
  );

  r.post(
    '/enrollments/:id/meeting-booked',
    { schema: { params: idParamSchema, response: { 200: okResponseSchema } } },
    async (req) => {
      const e = await getById(db, req.params.id);
      if (!e) throw AppError.notFound('enrollment');
      await store.withEnrollmentLock(e.id, async (tx) => {
        const current = await getById(tx, e.id);
        if (current?.meetingBooked) return;
        if (!(await hasConfirmedHumanReply(tx, e.id)))
          throw new AppError(
            'conflict',
            409,
            'Confirm a human response attributed to this campaign before recording a meeting.',
          );
        await store.appendUnderEnrollmentLock(tx, e.id, [
          buildEvent.meetingBooked({
            leadId: e.leadId,
            enrollmentId: e.id,
            campaignId: e.campaignId,
            occurredAt: clock.now(),
          }),
        ]);
      });
      return { ok: true } as const;
    },
  );

  r.post('/enrollments/:id/snooze', { schema: { params: idParamSchema } }, async () => {
    throw new AppError(
      'conflict',
      410,
      'Legacy snooze is retired. Use the audited Delay action with the current review revision.',
    );
  });

  r.post('/enrollments/:id/unsubscribe', { schema: { params: idParamSchema } }, async () => {
    throw new AppError(
      'conflict',
      410,
      'Use the confirmed Suppress address action. Suppression is permanent across campaigns.',
    );
  });

  r.post('/manual-sends', {}, async () => {
    throw new AppError(
      'conflict',
      410,
      'Direct manual sending has been retired. Save Personalized Copy and send it through a personalized sequence step.',
    );
  });
}
