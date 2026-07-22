// Boot: config → logger → compose → HTTP listen → graceful shutdown.
// ROLE branching (api|worker|all) becomes meaningful when pg-boss jobs land (B3).
import { loadConfig } from './config/env';
import { createLogger } from './config/logger';
import { compose } from './composition';
import { buildServer } from './api/server';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const services = compose(config);

  const app = buildServer({ logger, pool: services.pool });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
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
