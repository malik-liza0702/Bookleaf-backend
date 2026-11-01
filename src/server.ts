import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { connectDatabase, disconnectDatabase } from './lib/db.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });

  await connectDatabase(config.mongoUri, config.mongoDbName);
  logger.info({ db: config.mongoDbName }, 'Connected to MongoDB');

  const container = createContainer(config, logger);
  if (!container.ai.enabled) {
    logger.warn(
      'GEMINI_API_KEY is not set: running in degraded mode. Tickets are classified by rules and drafts use the template fallback.',
    );
  }

  const backfilled = await container.ticketRepository.backfillAuthorUpdatedAt();
  if (backfilled > 0) logger.info({ backfilled }, 'Backfilled authorUpdatedAt on existing tickets');

  // Crash recovery: anything still "pending" never got classified.
  const requeued = await container.classificationQueue.requeue(() =>
    container.ticketRepository.findPendingClassificationIds(),
  );
  if (requeued > 0) logger.info({ requeued }, 'Re-queued pending classifications');

  const server = createApp(container).listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'BookLeaf API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await container.classificationQueue.stop();
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
