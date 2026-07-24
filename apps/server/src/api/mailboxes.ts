// Mailbox route group (B6.2, docs/10 §Mailboxes). Passwords are sealed into
// mailbox_secrets (secrets/seal.ts) and NEVER serialized — the .strict()
// response schema is the tripwire.
import type { FastifyInstance } from 'fastify';
import {
  createMailboxBodySchema,
  idParamSchema,
  mailboxListResponseSchema,
  mailboxSchema,
  mailboxVolumeQuerySchema,
  mailboxVolumeResponseSchema,
  patchMailboxBodySchema,
  reconnectMailboxBodySchema,
  resumeMailboxBodySchema,
  testConnectionResponseSchema,
  type MailboxDto,
  type PatchMailboxBody,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import {
  createMailbox,
  getMailbox,
  getMailboxSecret,
  listMailboxes,
  patchMailbox,
  upsertMailboxSecret,
  type MailboxRow,
} from '../db/repos/mailboxesRepo';
import { mailboxVolume } from '../db/repos/metricsRepo';
import { mailboxStatsFor, type MailboxStats } from '../services/mailboxStats';
import { resumeMailbox } from '../services/autoPause';
import { mailboxImbalance } from '../services/metrics/watchRules';
import { sealSecret, unsealSecret } from '../secrets/seal';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toMailboxDto(row: MailboxRow, stats: MailboxStats): MailboxDto {
  return {
    id: row.id,
    display_name: row.displayName,
    from_address: row.fromAddress,
    smtp_host: row.smtpHost,
    smtp_port: row.smtpPort,
    imap_host: row.imapHost,
    imap_port: row.imapPort,
    daily_cap: row.dailyCap,
    effective_cap: row.resumeCap ?? row.dailyCap,
    send_window: row.sendWindow,
    status: row.status,
    status_reason: row.statusReason,
    sent_today: stats.sentToday,
    hard_bounce_pct: stats.hardBouncePct,
    seven_day_avg: stats.sevenDayAvg,
    last_successful_poll_at: row.lastSuccessfulPollAt?.toISOString() ?? null,
  };
}

function patchColumns(body: PatchMailboxBody) {
  return {
    ...(body.display_name !== undefined && { displayName: body.display_name }),
    ...(body.from_address !== undefined && { fromAddress: body.from_address }),
    ...(body.smtp_host !== undefined && { smtpHost: body.smtp_host }),
    ...(body.smtp_port !== undefined && { smtpPort: body.smtp_port }),
    ...(body.imap_host !== undefined && { imapHost: body.imap_host }),
    ...(body.imap_port !== undefined && { imapPort: body.imap_port }),
    ...(body.auth_type !== undefined && { authType: body.auth_type }),
    ...(body.daily_cap !== undefined && { dailyCap: body.daily_cap }),
    ...(body.send_window !== undefined && { sendWindow: body.send_window }),
  };
}

export async function mailboxesRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, transport, config, jobs } = services;

  const requireMailbox = async (id: number): Promise<MailboxRow> => {
    const row = await getMailbox(db, id);
    if (!row) throw AppError.notFound('mailbox');
    return row;
  };

  const dtoOf = async (row: MailboxRow): Promise<MailboxDto> => {
    const stats = await mailboxStatsFor({ db, clock }, [row]);
    return toMailboxDto(row, stats.get(row.id)!);
  };

  r.get('/mailboxes', { schema: { response: { 200: mailboxListResponseSchema } } }, async () => {
    const rows = await listMailboxes(db);
    const stats = await mailboxStatsFor({ db, clock }, rows);
    return { items: rows.map((row) => toMailboxDto(row, stats.get(row.id)!)) };
  });

  r.get(
    '/mailboxes/volume',
    {
      schema: {
        querystring: mailboxVolumeQuerySchema,
        response: { 200: mailboxVolumeResponseSchema },
      },
    },
    async (req) => {
      const now = clock.now();
      const from = new Date(now.getTime() - req.query.days * 86_400_000);
      const volume = await mailboxVolume(db, from, now);
      const byMailbox = new Map<number, { date: string; sends: number }[]>();
      for (const row of volume) {
        const series = byMailbox.get(row.mailbox_id) ?? [];
        series.push({ date: row.day, sends: row.sends });
        byMailbox.set(row.mailbox_id, series);
      }
      return {
        items: [...byMailbox.entries()].map(([mailbox_id, series]) => ({ mailbox_id, series })),
        imbalance: mailboxImbalance(volume).flag !== null,
      };
    },
  );

  r.post(
    '/mailboxes',
    { schema: { body: createMailboxBodySchema, response: { 200: mailboxSchema } } },
    async (req) => {
      const b = req.body;
      const row = await createMailbox(db, {
        displayName: b.display_name,
        fromAddress: b.from_address,
        smtpHost: b.smtp_host,
        smtpPort: b.smtp_port,
        imapHost: b.imap_host,
        imapPort: b.imap_port,
        authType: b.auth_type,
        dailyCap: b.daily_cap,
        sendWindow: b.send_window,
      });
      const sealed = await sealSecret(b.password, config.SECRET_KEY);
      await upsertMailboxSecret(db, row.id, sealed, clock.now());
      // Start polling THIS mailbox now: boot only registered the mailboxes that
      // existed then, so without this a mailbox added through the UI would go
      // unpolled until the next restart (no-op when workers aren't running).
      await jobs.registerMailboxPoll(row.id);
      return dtoOf(row);
    },
  );

  r.patch(
    '/mailboxes/:id',
    {
      schema: {
        params: idParamSchema,
        body: patchMailboxBodySchema,
        response: { 200: mailboxSchema },
      },
    },
    async (req) => {
      await requireMailbox(req.params.id);
      const cols = patchColumns(req.body);
      if (Object.keys(cols).length > 0) await patchMailbox(db, req.params.id, cols);
      if (req.body.password !== undefined) {
        const sealed = await sealSecret(req.body.password, config.SECRET_KEY);
        await upsertMailboxSecret(db, req.params.id, sealed, clock.now());
      }
      return dtoOf(await requireMailbox(req.params.id));
    },
  );

  r.post(
    '/mailboxes/:id/test-connection',
    { schema: { params: idParamSchema, response: { 200: testConnectionResponseSchema } } },
    async (req) => {
      const row = await requireMailbox(req.params.id);
      const sealed = await getMailboxSecret(db, row.id);
      const password = sealed ? await unsealSecret(sealed, config.SECRET_KEY) : '';
      const result = await transport.verify({
        smtpHost: row.smtpHost,
        smtpPort: row.smtpPort,
        imapHost: row.imapHost,
        imapPort: row.imapPort,
        fromAddress: row.fromAddress,
        password,
      });
      return {
        smtp_ok: result.smtpOk,
        imap_ok: result.imapOk,
        ...(result.roundTripMs !== undefined && { round_trip_ms: result.roundTripMs }),
      };
    },
  );

  r.post(
    '/mailboxes/:id/pause',
    { schema: { params: idParamSchema, response: { 200: mailboxSchema } } },
    async (req) => {
      await requireMailbox(req.params.id);
      await patchMailbox(db, req.params.id, {
        status: 'paused',
        statusReason: 'paused by operator',
        pausedAt: clock.now(),
      });
      return dtoOf(await requireMailbox(req.params.id));
    },
  );

  r.post(
    '/mailboxes/:id/resume',
    {
      schema: {
        params: idParamSchema,
        body: resumeMailboxBodySchema,
        response: { 200: mailboxSchema },
      },
    },
    async (req) => {
      const row = await requireMailbox(req.params.id);
      // Resume from auto_paused defaults to 50% cap (walkthrough Stage 7);
      // an operator-paused mailbox comes back at full cap.
      const capPct = req.body.cap_pct ?? (row.status === 'auto_paused' ? 50 : 100);
      await resumeMailbox({ db }, row.id, capPct, clock.now());
      return dtoOf(await requireMailbox(req.params.id));
    },
  );

  r.post(
    '/mailboxes/:id/reconnect',
    {
      schema: {
        params: idParamSchema,
        body: reconnectMailboxBodySchema,
        response: { 200: mailboxSchema },
      },
    },
    async (req) => {
      const row = await requireMailbox(req.params.id);
      const sealed = await sealSecret(req.body.password, config.SECRET_KEY);
      await upsertMailboxSecret(db, row.id, sealed, clock.now());
      const result = await transport.verify({
        smtpHost: row.smtpHost,
        smtpPort: row.smtpPort,
        imapHost: row.imapHost,
        imapPort: row.imapPort,
        fromAddress: row.fromAddress,
        password: req.body.password,
      });
      if (result.smtpOk && result.imapOk && row.status === 'auth_failed') {
        await patchMailbox(db, row.id, { status: 'ok', statusReason: null });
        // auth_failed mailboxes are skipped at boot registration — a recovered
        // one needs its poll queue (re-)registered to resume reply detection.
        await jobs.registerMailboxPoll(row.id);
      }
      return dtoOf(await requireMailbox(req.params.id));
    },
  );
}
