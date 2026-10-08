// Boot: config → logger → compose → workers (ROLE) → HTTP listen → graceful
// shutdown.
import { loadConfig } from './config/env';
import { createLogger } from './config/logger';
import { compose } from './composition';
import { buildServer } from './api/server';
import { ensureOperator } from './services/operatorAuth';
import { reapplyDeletionManifest } from './services/incomingContent';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const services = compose(config);
  await reapplyDeletionManifest(
    services.db,
    config.INCOMING_DELETION_MANIFEST_PATH,
    config.NODE_ENV === 'production',
  );

  // First-boot operator seed (decision I) — idempotent, before the API serves.
  await ensureOperator(services.db, config);

  // ROLE=worker runs the jobs only — no HTTP listener (decision Y's split
  // seam). A worker container therefore has no /health endpoint to probe.
  const servesApi = config.ROLE !== 'worker';
  const app = servesApi ? buildServer({ logger, services }) : null;

  if (config.SIMULATED_CLOCK) {
    // Virtual time: pg-boss cron never fires; POST /system/advance-clock
    // drives the scheduler/poller instead (docs/13 §5 — mock builds only).
    logger.warn('SIMULATED_CLOCK active — pg-boss workers NOT started');
  } else if (config.ROLE !== 'api') {
    await services.jobs.start(); // pg-boss: tick cron, polls, confirm-delivery
    logger.info('pg-boss workers started');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await services.jobs.stop();
    if (app) await app.close();
    await services.transport.close?.(); // SMTP pools (B8.1)
    await services.pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (app) await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    { role: config.ROLE, transport: config.MAIL_TRANSPORT, port: servesApi ? config.PORT : null },
    'coldemail server up',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
