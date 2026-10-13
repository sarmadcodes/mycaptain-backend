import { createServer } from 'node:http';

import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './lib/db';
import { redis } from './lib/kv';
import { logger } from './lib/logger';
import { attachRealtime, closeRealtime } from './lib/realtime';

async function main() {
  if (redis) await redis.connect();
  await connectDb();

  const server = createServer(createApp());
  attachRealtime(server);
  server.listen(env.PORT, () => logger.info(`api listening on :${env.PORT}`));

  // Graceful shutdown: stop accepting, finish in-flight requests, close connections.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close();
    await closeRealtime();
    await disconnectDb();
    await redis?.quit();
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
