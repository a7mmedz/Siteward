import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import type { Logger } from './lib/logger.js';
import { prisma } from './lib/db.js';
import { requireAuth } from './lib/auth.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { sitesRouter } from './routes/sites.js';
import { inspectionsRouter } from './routes/inspections.js';
import { DemoFailures, devRouter, syncRouter } from './routes/sync.js';
import { docsRouter } from './routes/docs.js';

export function createApp(config: Config, logger: Logger) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json({ limit: config.jsonLimit }));

  const api = Router();

  api.get('/health', async (_req, res) => {
    let db: 'up' | 'down' = 'up';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    res.status(db === 'up' ? 200 : 503).json({
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
    });
  });

  api.use('/auth', authRouter(config));
  api.use(docsRouter());

  // Everything below requires a valid token.
  const failures = new DemoFailures(config.failSyncRate);
  api.use(requireAuth(config.jwtSecret));
  api.use(sitesRouter());
  api.use(inspectionsRouter());
  api.use(syncRouter(failures));
  api.use(devRouter(config, failures));

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
