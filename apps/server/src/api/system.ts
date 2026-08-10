// System route group (B6.12, docs/10 + docs/13 §5): status, rebuild, the
// reply-detection debug list, and the test-only advance-clock — registered
// ONLY when composition built a SimulationDriver (SIMULATED_CLOCK).
import type { FastifyInstance } from 'fastify';
import {
  advanceClockBodySchema,
  advanceClockResponseSchema,
  incomingMessagesQuerySchema,
  incomingMessagesResponseSchema,
  rebuildBodySchema,
  rebuildResponseSchema,
  systemStatusResponseSchema,
} from '@coldemail/shared';
import { z } from 'zod';
import type { AppServices } from '../composition';
import { listIncoming, type IncomingMessageRow } from '../db/repos/incomingMessagesRepo';
import { listMailboxes } from '../db/repos/mailboxesRepo';
import { getById as getEnrollmentById } from '../db/repos/enrollmentsRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { rebuildProjections } from '../services/rebuildProjections';
import { loadCampaignShapes } from '../services/campaignShapes';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

// Test-only schemas (SIMULATED_CLOCK routes below) — not part of the contract.
const okResponseSchema = z.object({ ok: z.literal(true) }).strict();
const scriptInboundBodySchema = z
  .object({
    mailbox_id: z.number().int().positive(),
    kind: z.enum(['reply', 'ooo', 'bounce', 'spam']),
    to: z.string().optional(),
    from: z.string().optional(),
    subject: z.string().optional(),
    body_text: z.string().optional(),
    dsn_status: z.string().optional(),
  })
  .strict();
const scriptInboundResponseSchema = z.object({ ok: z.literal(true), uid: z.number() }).strict();
const scriptSendOutcomeBodySchema = z
  .object({
    recipient: z.string(),
    kind: z.enum(['accept', 'transient', 'permanent_recipient', 'permanent_mailbox']),
    error: z.string().optional(),
  })
  .strict();
const scriptVerifyBodySchema = z
  .object({
    from_address: z.string(),
    smtp_ok: z.boolean(),
    imap_ok: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

async function toDebugRow(services: AppServices, row: IncomingMessageRow) {
  const enrollment =
    row.matchedEnrollmentId === null
      ? null
      : await getEnrollmentById(services.db, row.matchedEnrollmentId);
  return {
    id: row.id,
    mailbox_id: row.mailboxId,
    from_address: row.fromAddress,
    subject: row.subject,
    classification: row.classification,
    dsn_status: row.dsnStatus,
    matched_enrollment_id: row.matchedEnrollmentId,
    matched_lead_id: enrollment?.leadId ?? null,
    resulting_event_ids: row.resultingEventIds,
    processed_at: row.processedAt.toISOString(),
  };
}

export async function systemRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, config, scheduler, jobs, sequences } = services;

  r.get(
    '/system/status',
    { schema: { response: { 200: systemStatusResponseSchema } } },
    async () => {
      const boxes = await listMailboxes(db);
      return {
        scheduler_last_tick_at: scheduler.lastTickAt?.toISOString() ?? null,
        transport_mode: config.MAIL_TRANSPORT,
        pollers: boxes.map((mb) => ({
          mailbox_id: mb.id,
          mailbox_address: mb.fromAddress,
          last_successful_poll_at: mb.lastSuccessfulPollAt?.toISOString() ?? null,
        })),
        pending_jobs: await jobs.pendingCount(),
        send_blockers: [...scheduler.sendBlockers],
      };
    },
  );

  r.post(
    '/system/rebuild-projections',
    { schema: { body: rebuildBodySchema, response: { 200: rebuildResponseSchema } } },
    async (req) => {
      const settings = await getSettings(db);
      const shapeFor = await loadCampaignShapes(db, sequences, settings.softRetryMax);
      const result = await rebuildProjections(db, {
        dryRun: req.body.dry_run,
        campaignId: null,
        shapeFor,
        deliveryConfirmMs: settings.deliveryConfirmHours * 3_600_000,
        now: clock.now(),
      });
      return {
        diffs: result.diffs.length,
        ...(result.diffs.length > 0 && {
          details: result.diffs.map((d) => ({
            enrollment_id: d.enrollmentId,
            field: d.field,
            stored: d.stored,
            derived: d.derived,
          })),
        }),
      };
    },
  );

  r.get(
    '/incoming-messages',
    {
      schema: {
        querystring: incomingMessagesQuerySchema,
        response: { 200: incomingMessagesResponseSchema },
      },
    },
    async (req) => {
      const { page, per_page, classification, mailbox_id } = req.query;
      const { items, total } = await listIncoming(db, {
        classification,
        mailboxId: mailbox_id,
        page,
        perPage: per_page,
      });
      return {
        items: await Promise.all(items.map((item) => toDebugRow(services, item))),
        total,
        page,
        per_page,
      };
    },
  );

  // Test-only (docs/13 §5): absent entirely — a 404 — unless SIMULATED_CLOCK.
  if (services.simulation) {
    const simulation = services.simulation;
    r.post(
      '/system/advance-clock',
      { schema: { body: advanceClockBodySchema, response: { 200: advanceClockResponseSchema } } },
      async (req) => {
        const { now, ticks } = await simulation.advance({
          days: req.body.days,
          hours: req.body.hours,
          minutes: req.body.minutes,
        });
        return { ok: true, now: now.toISOString(), ticks } as const;
      },
    );

    // Script the mock transport the way the in-process scenario runner does
    // (docs/13 §5). Inline schemas — these are test hooks, not the contract.
    r.post(
      '/system/script-inbound',
      { schema: { body: scriptInboundBodySchema, response: { 200: scriptInboundResponseSchema } } },
      async (req) => {
        const b = req.body;
        const res = simulation.scriptInbound({
          mailboxId: b.mailbox_id,
          kind: b.kind,
          ...(b.to !== undefined && { to: b.to }),
          ...(b.from !== undefined && { from: b.from }),
          ...(b.subject !== undefined && { subject: b.subject }),
          ...(b.body_text !== undefined && { bodyText: b.body_text }),
          ...(b.dsn_status !== undefined && { dsnStatus: b.dsn_status }),
        });
        if (!res)
          throw new AppError('conflict', 409, 'no accepted send to thread this inbound onto');
        return { ok: true, uid: res.uid } as const;
      },
    );

    r.post(
      '/system/script-send-outcome',
      { schema: { body: scriptSendOutcomeBodySchema, response: { 200: okResponseSchema } } },
      async (req) => {
        simulation.scriptSendOutcome(req.body.recipient, {
          kind: req.body.kind,
          ...(req.body.error !== undefined && { error: req.body.error }),
        });
        return { ok: true } as const;
      },
    );

    r.post(
      '/system/script-verify',
      { schema: { body: scriptVerifyBodySchema, response: { 200: okResponseSchema } } },
      async (req) => {
        simulation.scriptVerify(req.body.from_address, {
          smtpOk: req.body.smtp_ok,
          imapOk: req.body.imap_ok,
          ...(req.body.error !== undefined && { error: req.body.error }),
        });
        return { ok: true } as const;
      },
    );
  }
}
