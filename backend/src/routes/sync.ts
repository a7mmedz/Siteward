import { Router } from 'express';
import { z } from 'zod';
import type { Config } from '../config.js';
import { currentUser, requireRole } from '../lib/auth.js';
import { AppError, notFound, parse } from '../lib/errors.js';
import { processBatch, syncBodySchema } from '../sync/service.js';

/**
 * In-memory switches for demonstrating failed sync and recovery (AC8).
 * `before`: fail without touching the database. `after`: apply the ops, then answer 500 as if the
 * response was lost, so the client's retry shows idempotency (AC6).
 */
export class DemoFailures {
  private queue: ('before' | 'after')[] = [];

  constructor(private readonly randomRate: number) {}

  schedule(count: number, mode: 'before' | 'after') {
    this.queue = Array.from({ length: count }, () => mode);
  }

  clear() {
    this.queue = [];
  }

  pending() {
    return this.queue.length;
  }

  /** Decide the fate of the next /sync request. */
  next(): 'before' | 'after' | null {
    const scheduled = this.queue.shift();
    if (scheduled) return scheduled;
    return this.randomRate > 0 && Math.random() < this.randomRate ? 'before' : null;
  }
}

const simulatedFailure = () =>
  new AppError(500, 'SIMULATED_FAILURE', 'Simulated server failure (demo tools)');

export function syncRouter(failures: DemoFailures) {
  const router = Router();

  router.post('/sync', async (req, res) => {
    const { ops } = parse(syncBodySchema, req.body);
    const user = currentUser(req);
    const failure = failures.next();
    if (failure === 'before') throw simulatedFailure();

    const results = await processBatch(user, ops);
    req.log.info(
      {
        userId: user.id,
        ops: ops.length,
        statuses: results.reduce<Record<string, number>>((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {}),
      },
      'sync batch processed',
    );
    if (failure === 'after') throw simulatedFailure();
    res.json({ results, serverTime: new Date().toISOString() });
  });

  return router;
}

const failSchema = z.object({
  count: z.number().int().min(0).max(20).default(1),
  mode: z.enum(['before', 'after']).default('before'),
});

/** Supervisor-only demo endpoints. Mounted only when DEMO_TOOLS=true; 404 otherwise. */
export function devRouter(config: Config, failures: DemoFailures) {
  const router = Router();
  router.use('/dev', (_req, _res, next) => {
    if (!config.demoTools) throw notFound('Demo tools are disabled');
    next();
  });
  router.use('/dev', requireRole('supervisor'));

  router.post('/dev/fail-next-sync', (req, res) => {
    const { count, mode } = parse(failSchema, req.body ?? {});
    failures.schedule(count, mode);
    res.json({ scheduled: failures.pending(), mode });
  });

  return router;
}
