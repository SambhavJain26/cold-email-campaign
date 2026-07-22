import { createRequire } from 'node:module';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from '../config/logger';
import { registerErrorHandling } from './plugins/errorHandler';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

export interface ServerDeps {
  logger: Logger;
  pool: Pool;
}

/** Build the Fastify app (no listen - main.ts listens, tests inject). */
export function buildServer({ logger, pool }: ServerDeps): FastifyInstance {
  // Cast: our pino Logger satisfies FastifyBaseLogger structurally; without it
  // the instance's logger generic infects every consumer's FastifyInstance type.
  const app: FastifyInstance = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  registerErrorHandling(app);

  // Unauthenticated liveness/readiness (docs/10). Everything else added in B6.
  app.get('/health', async () => {
    let db = false;
    try {
      await pool.query('SELECT 1');
      db = true;
    } catch (err) {
      app.log.warn({ err }, 'health: db unreachable');
    }
    return { ok: db, db, version: pkg.version };
  });

  return app;
}
