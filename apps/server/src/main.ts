// Boot: config → logger → compose → workers (ROLE) → HTTP listen → graceful
// shutdown.
import { loadConfig } from './config/env';
import { createLogger } from './config/logger';
import { compose } from './composition';
import { buildServer } from './api/server';
import { ensureOperator } from './services/operatorAuth';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const services = compose(config);

  // First-boot operator seed (decision I) — idempotent, before the API serves.
  await ensureOperator(services.db, config);

  const app = buildServer({ logger, services });

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
    await app.close();
    await services.pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    { role: config.ROLE, transport: config.MAIL_TRANSPORT, port: config.PORT },
    'coldemail server up',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
