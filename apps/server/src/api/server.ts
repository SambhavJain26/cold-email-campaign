import { createRequire } from 'node:module';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Logger } from '../config/logger';
import type { AppServices } from '../composition';
import { registerErrorHandling } from './plugins/errorHandler';
import { registerZodCompilers } from './plugins/zodCompilers';
import { registerSession } from './plugins/session';
import { registerCsrfHeader } from './plugins/csrfHeader';
import { registerRequireAuth } from './plugins/requireAuth';
import { authRoutes } from './auth';
import { googleOauthCallbackRoutes, mailboxesRoutes } from './mailboxes';
import { settingsRoutes } from './settings';
import { alertsRoutes } from './alerts';
import { leadsRoutes } from './leads';
import { importsRoutes } from './imports';
import { sequencesRoutes } from './sequences';
import { campaignsRoutes } from './campaigns';
import { uniboxRoutes } from './unibox';
import { analyticsRoutes } from './analytics';
import { systemRoutes } from './system';
import { publicUnsubscribeRoutes } from './publicUnsubscribe';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

export interface ServerDeps {
  logger: Logger;
  services: AppServices;
}

/** Build the Fastify app (no listen — main.ts listens, tests inject). */
export function buildServer({ logger, services }: ServerDeps): FastifyInstance {
  // Cast: our pino Logger satisfies FastifyBaseLogger structurally; without it
  // the instance's logger generic infects every consumer's FastifyInstance type.
  const app: FastifyInstance = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  registerErrorHandling(app);

  // Unauthenticated liveness/readiness (docs/10) — outside the /api/v1 scope.
  app.get('/health', async () => {
    let db = false;
    try {
      await services.pool.query('SELECT 1');
      db = true;
    } catch (err) {
      app.log.warn({ err }, 'health: db unreachable');
    }
    return { ok: db, db, version: pkg.version };
  });

  // Public unsubscribe (docs/16 §8) — deliberately OUTSIDE /api/v1 so it
  // inherits neither the session plugin nor the CSRF header check: Gmail's
  // one-click POST carries neither. See the route file for the full rules.
  void app.register(async (pub) => {
    await publicUnsubscribeRoutes(pub, services);
    await googleOauthCallbackRoutes(pub, services);
  });

  // The /api/v1 scope (docs/10): zod compilers → session → CSRF header →
  // requireAuth → route groups. Route groups grow as B6 checkpoints land.
  void app.register(
    async (api) => {
      registerZodCompilers(api);
      await registerSession(api, services.config);
      registerCsrfHeader(api);
      registerRequireAuth(api);
      await authRoutes(api, services);
      await mailboxesRoutes(api, services);
      await settingsRoutes(api, services);
      await alertsRoutes(api, services);
      await leadsRoutes(api, services);
      await importsRoutes(api, services);
      await sequencesRoutes(api, services);
      await campaignsRoutes(api, services);
      await uniboxRoutes(api, services);
      await analyticsRoutes(api, services);
      await systemRoutes(api, services);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
