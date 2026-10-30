import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { prisma } from './lib/db.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp(config, logger);

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, demoTools: config.demoTools, failSyncRate: config.failSyncRate },
    'Siteward API listening',
  );
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
