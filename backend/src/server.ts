import { env } from './config/env';
import { connectMeta, disconnectAll } from './db/connections';
import { ensureMetaIndexes } from './models/meta';
import { seedHieContracts } from './integrations/hie/contractService';
import { seedPlans } from './modules/plans/planService';
import { bootstrapPlatformConfigsFromEnv } from './modules/integrations/integrationConfigService';
import { registerJobHandlers } from './jobs/handlers';
import { startWorker, stopWorker } from './jobs/queue';
import { createApp } from './app';
import { runTenantMigrations } from './modules/tenants/migrations';
import { logger } from './utils/logger';

async function main() {
  await connectMeta();
  await ensureMetaIndexes();
  await seedHieContracts();
  await seedPlans();
  await bootstrapPlatformConfigsFromEnv();
  await runTenantMigrations();
  registerJobHandlers();
  if (env.RUN_WORKERS) startWorker();

  const server = createApp().listen(env.PORT, () => logger.info(`AfeySync API listening on :${env.PORT}`));
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopWorker();
    server.close();
    await disconnectAll();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
