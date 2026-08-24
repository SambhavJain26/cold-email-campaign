// Mailbox route group (B6.2, docs/10 §Mailboxes). Passwords are sealed into
// mailbox_secrets (secrets/seal.ts) and NEVER serialized — the .strict()
// response schema is the tripwire.
import type { FastifyInstance } from 'fastify';
import {
  createMailboxBodySchema,
  idParamSchema,
  mailboxListResponseSchema,
  mailboxFoldersResponseSchema,
  mailboxSchema,
  mailboxVolumeQuerySchema,
  mailboxVolumeResponseSchema,
  patchMailboxBodySchema,
  reconnectMailboxBodySchema,
  googleOauthDisconnectResponseSchema,
  googleOauthStartResponseSchema,
  resumeMailboxBodySchema,
  testConnectionResponseSchema,
  type MailboxDto,
  type PatchMailboxBody,
} from '@coldemail/shared';
import type { AppServices } from '../composition';
import {
  createMailbox,
  getMailbox,
  listMailboxes,
  patchMailbox,
  upsertMailboxSecret,
  type MailboxRow,
} from '../db/repos/mailboxesRepo';
import { hasOauthCredential } from '../db/repos/mailboxOauthRepo';
import { mailboxVolume } from '../db/repos/metricsRepo';
import { getSettings } from '../db/repos/settingsRepo';
import { getCursor, seedCursorIfAbsent } from '../db/repos/pollCursorsRepo';
import { checkMailboxDailyCap } from '../services/guardrails';
import type { Db } from '../db/client';
import { mailboxStatsFor, type MailboxStats } from '../services/mailboxStats';
import { resumeMailbox } from '../services/autoPause';
import { mailboxImbalance } from '../services/metrics/watchRules';
import { sealSecret } from '../secrets/seal';
import type { MailboxVerifyConfig } from '../transport/types';
import { GoogleOauthError } from '../services/googleOAuth';
import { AppError } from './errors';
import type { ZodTypeProvider } from './plugins/zodCompilers';

function toMailboxDto(row: MailboxRow, stats: MailboxStats, oauthConnected: boolean): MailboxDto {
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
    timezone: row.timezone,
    poll_folders: row.pollFolders,
    auth_type: row.authType === 'google_oauth' ? 'google_oauth' : 'app_password',
    oauth_connected: oauthConnected,
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
    ...(body.daily_cap !== undefined && { dailyCap: body.daily_cap }),
    ...(body.send_window !== undefined && { sendWindow: body.send_window }),
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.poll_folders !== undefined && { pollFolders: body.poll_folders }),
  };
}

/**
 * Seed each polled folder's cursor from its UIDNEXT (finding 16, per folder
 * since 0012). Without this, connecting a mailbox — or merely ADDING a folder
 * to an existing one — ingests that folder's entire history: 12,581 messages
 * back to 2022 on the real canary. Idempotent: an already-seeded folder keeps
 * its position.
 */
async function seedPollCursorsFor(
  services: AppServices,
  row: {
    id: number;
    smtpHost: string;
    smtpPort: number;
    imapHost: string;
    imapPort: number;
    fromAddress: string;
    pollFolders: string[];
  },
  connection: MailboxVerifyConfig,
): Promise<void> {
  const { db, transport } = services;
  if (!transport.initialPollUid) return;
  for (const folder of row.pollFolders) {
    if ((await getCursor(db, row.id, folder)) !== null) continue;
    await seedCursorIfAbsent(
      db,
      row.id,
      folder,
      await transport.initialPollUid(connection, folder),
    );
  }
}

async function discoveredFolders(
  services: AppServices,
  connection: MailboxVerifyConfig,
): Promise<Array<{ name: string; specialUse?: string }>> {
  try {
    return await services.transport.listFolders(connection);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'folder discovery failed';
    throw new AppError('mailbox_unhealthy', 409, `Could not discover IMAP folders: ${message}`);
  }
}

function assertFoldersExist(
  selected: string[],
  discovered: Array<{ name: string; specialUse?: string }>,
): void {
  const names = new Set(discovered.map((folder) => folder.name));
  const missing = selected.filter((folder) => !names.has(folder));
  if (missing.length > 0) {
    throw new AppError('validation', 422, `These IMAP folders do not exist: ${missing.join(', ')}`);
  }
}

/** Launch guardrail (0011): refuse a cap above the configured ceiling. */
async function assertDailyCapWithinGuardrail(db: Db, dailyCap: number | undefined): Promise<void> {
  if (dailyCap === undefined) return;
  const s = await getSettings(db);
  const violation = checkMailboxDailyCap(dailyCap, {
    maxMailboxDailyCap: s.maxMailboxDailyCap,
    maxRampDailyEnrollCap: s.maxRampDailyEnrollCap,
    minRampDays: s.minRampDays,
  });
  if (violation) throw new AppError('validation', 422, violation);
}

function assertIanaTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new AppError('validation', 400, 'timezone must be a valid IANA timezone');
  }
}

function localDateKey(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function localCalendarDays(now: Date, timezone: string, count: number): string[] {
  const [year, month, day] = localDateKey(now, timezone).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day - (count - 1 - index)));
    return date.toISOString().slice(0, 10);
  });
}

export async function mailboxesRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { db, clock, transport, config, jobs, googleOAuth, mailboxConnections } = services;

  const requireMailbox = async (id: number): Promise<MailboxRow> => {
    const row = await getMailbox(db, id);
    if (!row) throw AppError.notFound('mailbox');
    return row;
  };

  const dtoOf = async (row: MailboxRow): Promise<MailboxDto> => {
    const stats = await mailboxStatsFor({ db, clock }, [row]);
    return toMailboxDto(row, stats.get(row.id)!, await hasOauthCredential(db, row.id));
  };

  r.get('/mailboxes', { schema: { response: { 200: mailboxListResponseSchema } } }, async () => {
    const rows = await listMailboxes(db);
    const stats = await mailboxStatsFor({ db, clock }, rows);
    return {
      items: await Promise.all(
        rows.map(async (row) =>
          toMailboxDto(row, stats.get(row.id)!, await hasOauthCredential(db, row.id)),
        ),
      ),
    };
  });

  r.get(
    '/mailboxes/:id/folders',
    {
      schema: {
        params: idParamSchema,
        response: { 200: mailboxFoldersResponseSchema },
      },
    },
    async (req) => {
      const row = await requireMailbox(req.params.id);
      const connection = await mailboxConnections.load(row.id);
      if (!connection) {
        throw new AppError('mailbox_unhealthy', 409, 'Mailbox credentials are not connected');
      }
      return {
        items: (await discoveredFolders(services, connection)).map((folder) => ({
          name: folder.name,
          special_use: folder.specialUse ?? null,
        })),
      };
    },
  );

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
      const from = new Date(now.getTime() - (req.query.days + 1) * 86_400_000);
      const volume = await mailboxVolume(db, from, now);
      const rows = await listMailboxes(db);
      const byMailbox = new Map<number, Map<string, number>>();
      for (const row of volume) {
        const series = byMailbox.get(row.mailbox_id) ?? new Map<string, number>();
        series.set(row.day, row.sends);
        byMailbox.set(row.mailbox_id, series);
      }
      const allRows = rows.flatMap((mailbox) =>
        localCalendarDays(now, mailbox.timezone, req.query.days).map((day) => ({
          mailbox_id: mailbox.id,
          day,
          sends: byMailbox.get(mailbox.id)?.get(day) ?? 0,
        })),
      );
      return {
        items: rows.map((mailbox) => ({
          mailbox_id: mailbox.id,
          series: allRows
            .filter((row) => row.mailbox_id === mailbox.id)
            .map(({ day, sends }) => ({ date: day, sends })),
        })),
        imbalance: mailboxImbalance(allRows).flag !== null,
      };
    },
  );

  r.post(
    '/mailboxes',
    { schema: { body: createMailboxBodySchema, response: { 200: mailboxSchema } } },
    async (req) => {
      const b = req.body;
      const authType = b.auth_type ?? 'app_password';
      if (b.timezone !== undefined) assertIanaTimezone(b.timezone);
      await assertDailyCapWithinGuardrail(db, b.daily_cap);
      const pollFolders =
        b.poll_folders ?? (authType === 'google_oauth' ? ['INBOX', '[Gmail]/Spam'] : ['INBOX']);
      let createConnection: MailboxVerifyConfig | null = null;
      if (authType === 'app_password') {
        createConnection = {
          smtpHost: b.smtp_host!,
          smtpPort: b.smtp_port ?? 587,
          imapHost: b.imap_host!,
          imapPort: b.imap_port ?? 993,
          fromAddress: b.from_address,
          authType,
          password: b.password!,
        };
        assertFoldersExist(pollFolders, await discoveredFolders(services, createConnection));
      }
      const cursorSeeds =
        authType === 'app_password'
          ? await Promise.all(
              pollFolders.map(async (folder) => ({
                folder,
                uid: transport.initialPollUid
                  ? await transport.initialPollUid(createConnection!, folder)
                  : 0,
              })),
            )
          : [];
      const sealed =
        authType === 'app_password' ? await sealSecret(b.password!, config.SECRET_KEY) : null;
      const row = await db.transaction(async (tx) => {
        const created = await createMailbox(tx, {
          displayName: b.display_name,
          fromAddress: b.from_address,
          smtpHost: authType === 'google_oauth' ? 'smtp.gmail.com' : b.smtp_host!,
          smtpPort: b.smtp_port,
          imapHost: authType === 'google_oauth' ? 'imap.gmail.com' : b.imap_host!,
          imapPort: b.imap_port,
          authType,
          dailyCap: b.daily_cap,
          sendWindow: b.send_window,
          timezone: b.timezone,
          pollFolders,
          status: authType === 'google_oauth' ? 'setup_required' : 'ok',
        });
        if (sealed) {
          await upsertMailboxSecret(tx, created.id, sealed, clock.now());
          for (const seed of cursorSeeds) {
            await seedCursorIfAbsent(tx, created.id, seed.folder, seed.uid);
          }
        }
        return created;
      });
      if (authType === 'app_password') {
        // OAuth mailboxes remain setup_required and unregistered until the
        // callback stores a valid refresh credential.
        await jobs.registerMailboxPoll(row.id);
      }
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
      const existing = await requireMailbox(req.params.id);
      if (req.body.timezone !== undefined) assertIanaTimezone(req.body.timezone);
      await assertDailyCapWithinGuardrail(db, req.body.daily_cap);
      const cols = patchColumns(req.body);
      if (req.body.poll_folders !== undefined) {
        const connection = await mailboxConnections.load(existing.id);
        if (!connection) {
          throw new AppError(
            'mailbox_unhealthy',
            409,
            'Connect mailbox credentials before changing polled folders',
          );
        }
        assertFoldersExist(req.body.poll_folders, await discoveredFolders(services, connection));
        const newFolders = req.body.poll_folders.filter(
          (folder) => !existing.pollFolders.includes(folder),
        );
        const seeds = await Promise.all(
          newFolders.map(async (folder) => ({
            folder,
            uid: transport.initialPollUid ? await transport.initialPollUid(connection, folder) : 0,
          })),
        );
        await db.transaction(async (tx) => {
          await patchMailbox(tx, req.params.id, cols);
          for (const seed of seeds) {
            await seedCursorIfAbsent(tx, req.params.id, seed.folder, seed.uid);
          }
        });
      } else if (Object.keys(cols).length > 0) {
        await patchMailbox(db, req.params.id, cols);
      }
      if (req.body.password !== undefined) {
        if (existing.authType === 'google_oauth') {
          throw new AppError('validation', 422, 'OAuth mailboxes do not accept passwords');
        }
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
      const connection = await mailboxConnections.load(row.id);
      if (!connection)
        throw new AppError('mailbox_unhealthy', 409, 'Mailbox credentials are not connected');
      const result = await transport.verify(connection);
      const folders = result.imapOk ? await discoveredFolders(services, connection) : [];
      const byName = new Map(folders.map((folder) => [folder.name, folder]));
      return {
        smtp_ok: result.smtpOk,
        imap_ok: result.imapOk,
        ...(result.roundTripMs !== undefined && { round_trip_ms: result.roundTripMs }),
        folders: row.pollFolders.map((name) => ({
          name,
          exists: byName.has(name),
          special_use: byName.get(name)?.specialUse ?? null,
        })),
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
      if (row.authType === 'google_oauth') {
        throw new AppError('validation', 422, 'Use Reconnect Google for an OAuth mailbox');
      }
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
      // Seed any folder that has no cursor yet — a legacy mailbox from before
      // 0012, or a folder the operator just added. seedPollCursorsFor skips
      // folders that already have one, so a reconnect can never discard
      // messages that arrived while the mailbox was unavailable.
      if (result.smtpOk && result.imapOk) {
        const connection = await mailboxConnections.load(row.id);
        if (connection) await seedPollCursorsFor(services, row, connection);
      }
      return dtoOf(await requireMailbox(req.params.id));
    },
  );

  r.post(
    '/mailboxes/:id/oauth/google/start',
    {
      schema: {
        params: idParamSchema,
        response: { 200: googleOauthStartResponseSchema },
      },
    },
    async (req) => {
      await requireMailbox(req.params.id);
      try {
        return { authorization_url: await googleOAuth.authorizationUrl(req.params.id) };
      } catch (err) {
        if (err instanceof GoogleOauthError) {
          throw new AppError('validation', 422, err.message);
        }
        throw err;
      }
    },
  );

  r.post(
    '/mailboxes/:id/oauth/google/disconnect',
    {
      schema: {
        params: idParamSchema,
        response: { 200: googleOauthDisconnectResponseSchema },
      },
    },
    async (req) => {
      const row = await requireMailbox(req.params.id);
      if (row.authType !== 'google_oauth') {
        throw new AppError('validation', 422, 'Mailbox does not use Google OAuth');
      }
      await googleOAuth.disconnect(row.id);
      return { ok: true as const };
    },
  );
}

/** Public callback: state + PKCE are the authorization boundary, not a cookie session. */
export async function googleOauthCallbackRoutes(
  app: FastifyInstance,
  services: AppServices,
): Promise<void> {
  app.get('/oauth/google/callback', async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const state = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : '';
    const base = services.config.PUBLIC_APP_URL.replace(/\/$/, '');
    if (!state || !code || query.error !== undefined) {
      return reply.redirect(`${base}/mailboxes?oauth=error`);
    }
    try {
      const mailboxId = await services.googleOAuth.completeAuthorization(state, code);
      const connection = await services.mailboxConnections.load(mailboxId);
      const row = await getMailbox(services.db, mailboxId);
      if (connection && row) await seedPollCursorsFor(services, row, connection);
      await services.jobs.registerMailboxPoll(mailboxId);
      return reply.redirect(`${base}/mailboxes?oauth=connected`);
    } catch (err) {
      if (!(err instanceof GoogleOauthError))
        req.log.error({ err }, 'Google OAuth callback failed');
      return reply.redirect(`${base}/mailboxes?oauth=error`);
    }
  });
}
