// System route group (B6.12, docs/10 + docs/13 §5): status, rebuild, the
// reply-detection debug list, and the test-only advance-clock - registered
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
import type { AppServices } from '../composition';
import { listIncoming, type IncomingMessageRow } from '../db/repos/incomingMessagesRepo';
import { listMailboxes } from '../db/repos/mailboxesRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { rebuildProjections } from '../services/rebuildProjections';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toDebugRow(row: IncomingMessageRow) {
  return {
    id: row.id,
    mailbox_id: row.mailboxId,
    from_address: row.fromAddress,
    subject: row.subject,
    classification: row.classification,
    dsn_status: row.dsnStatus,
    matched_enrollment_id: row.matchedEnrollmentId,
    resulting_event_ids: row.resultingEventIds,
    processed_at: row.processedAt.toISOString(),
  };
}

export async function systemRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, config, scheduler, jobs } = services;

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
          last_successful_poll_at: mb.lastSuccessfulPollAt?.toISOString() ?? null,
        })),
        pending_jobs: await jobs.pendingCount(),
      };
    },
  );

  r.post(
    '/system/rebuild-projections',
    { schema: { body: rebuildBodySchema, response: { 200: rebuildResponseSchema } } },
    async (req) => {
      const settings = await getSettings(db);
      const result = await rebuildProjections(db, {
        dryRun: req.body.dry_run,
        campaignId: null,
        // Same shape rule as the CLI: completion is derived per campaign at
        // fold time; the DB sequence lookup arrives with B7's compare job.
        shapeFor: () => ({
          lastStepNo: Number.POSITIVE_INFINITY,
          softRetryMax: settings.softRetryMax,
        }),
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
      return { items: items.map(toDebugRow), total, page, per_page };
    },
  );

  // Test-only (docs/13 §5): absent entirely - a 404 - unless SIMULATED_CLOCK.
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
  }
}
