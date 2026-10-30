import type { LastSyncInfo, SitewardDb } from '../db/db';
import type { Api } from '../lib/api';
import { ApiError } from '../lib/api';
import type { InspectionDto, OpResult, OutboxOp } from '../lib/types';
import type { Repository } from '../data/repository';
import { createStatusStore } from './status';

export const MAX_BATCH = 50;
export const SYNC_INTERVAL_MS = 30_000;
const LOCAL_CHANGE_DEBOUNCE_MS = 800;
/** Overlap subtracted from serverTime, so rows committed while we were pulling are not missed. */
const PULL_OVERLAP_MS = 2_000;

/** 2s, 4s, 8s, … capped at 60s. */
export function backoffMs(failures: number) {
  return Math.min(60_000, 2 ** Math.max(1, failures) * 1000);
}

export type EngineDeps = {
  db: SitewardDb;
  api: Api;
  repo: Repository;
  isOnline?: () => boolean;
  now?: () => number;
  /** Called on 401: the session expired. Queued data is kept. */
  onAuthRequired?: () => void;
  /** Disable timers (interval, retry, debounce) — used by unit tests that drive sync by hand. */
  timers?: boolean;
};

const wire = (op: OutboxOp) => ({
  opId: op.opId,
  type: op.type,
  entity: op.entity,
  entityId: op.entityId,
  baseVersion: op.baseVersion,
  payload: op.payload,
});

/**
 * The only component that talks to the server about inspections (PLAN.md §6).
 * Push the outbox, then pull changes. One run at a time; failures back off and keep data queued.
 */
export class SyncEngine {
  readonly status;
  private running: Promise<void> | null = null;
  private again = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private retryId: ReturnType<typeof setTimeout> | null = null;
  private debounceId: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;
  private readonly timers: boolean;

  constructor(private readonly deps: EngineDeps) {
    this.isOnline = deps.isOnline ?? (() => navigator.onLine);
    this.now = deps.now ?? (() => Date.now());
    this.timers = deps.timers ?? true;
    this.status = createStatusStore({
      online: this.isOnline(),
      phase: 'idle',
      lastSyncAt: null,
      lastError: null,
      nextRetryAt: null,
      failures: 0,
    });
  }

  private readonly handleOnline = () => {
    this.status.set({ online: true });
    void this.syncNow({ manual: true });
  };

  private readonly handleOffline = () => {
    this.status.set({ online: false });
  };

  /** Triggers: start, `online` event, every 30s while online, local changes, "Sync now". */
  start() {
    if (this.started) return;
    this.started = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    if (this.timers) {
      this.intervalId = setInterval(() => {
        const s = this.status.get();
        if (s.phase === 'auth') return;
        if (s.nextRetryAt && this.now() < s.nextRetryAt) return;
        void this.syncNow();
      }, SYNC_INTERVAL_MS);
    }
    void this.syncNow();
  }

  stop() {
    this.started = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    for (const id of [this.intervalId, this.retryId, this.debounceId]) {
      if (id) clearTimeout(id as ReturnType<typeof setTimeout>);
    }
    this.intervalId = this.retryId = this.debounceId = null;
  }

  /** A local write happened: sync soon (debounced, so typing does not send a request per key). */
  notifyLocalChange() {
    if (!this.started || !this.timers) return;
    if (this.debounceId) clearTimeout(this.debounceId);
    this.debounceId = setTimeout(() => {
      this.debounceId = null;
      const s = this.status.get();
      if (s.phase === 'failed' && s.nextRetryAt && this.now() < s.nextRetryAt) return;
      void this.syncNow();
    }, LOCAL_CHANGE_DEBOUNCE_MS);
  }

  /**
   * Run a sync. Concurrent calls share the running one (the lock); a call made while running
   * schedules one more run afterwards, so a change made mid-sync is not left waiting 30s.
   * `manual` (button, reconnect, re-login) skips the backoff wait.
   */
  syncNow(opts: { manual?: boolean } = {}): Promise<void> {
    const online = this.isOnline();
    this.status.set({ online });
    if (!online) return Promise.resolve();
    if (opts.manual && this.retryId) {
      clearTimeout(this.retryId);
      this.retryId = null;
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again && this.status.get().phase === 'idle') {
        this.again = false;
        void this.syncNow();
      }
      this.again = false;
    });
    return this.running;
  }

  private async run() {
    this.status.set({ phase: 'syncing' });
    try {
      await this.push();
      await this.pull();
      this.status.set({
        phase: 'idle',
        failures: 0,
        lastError: null,
        nextRetryAt: null,
        lastSyncAt: new Date(this.now()).toISOString(),
      });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      if (apiError?.isAuth) {
        this.status.set({ phase: 'auth', lastError: apiError.message, nextRetryAt: null });
        this.deps.onAuthRequired?.();
        return;
      }
      const failures = this.status.get().failures + 1;
      const delay = backoffMs(failures);
      this.status.set({
        phase: 'failed',
        failures,
        lastError: err instanceof Error ? err.message : String(err),
        nextRetryAt: this.now() + delay,
        online: this.isOnline(),
      });
      if (this.timers && this.started) {
        if (this.retryId) clearTimeout(this.retryId);
        this.retryId = setTimeout(() => {
          this.retryId = null;
          void this.syncNow();
        }, delay);
      }
    }
  }

  /**
   * Ops eligible to send now: in outbox order, at most one per record (later ops for the same
   * record wait to be rebased on the version the earlier one produces), skipping records with a
   * parked (conflicting) op.
   */
  async nextBatch(): Promise<OutboxOp[]> {
    const all = await this.deps.db.outbox.orderBy('seq').toArray();
    const blocked = new Set(all.filter((o) => o.parked).map((o) => o.entityId));
    const batch: OutboxOp[] = [];
    for (const op of all) {
      if (batch.length >= MAX_BATCH) break;
      if (blocked.has(op.entityId)) continue;
      blocked.add(op.entityId);
      batch.push(op);
    }
    return batch;
  }

  private async push() {
    const { db, api } = this.deps;
    // Bounded: each round removes or parks every op it sends, or throws.
    for (let round = 0; round < 100; round++) {
      const batch = await this.nextBatch();
      if (!batch.length) return;

      const sentAt = new Date(this.now()).toISOString();
      await db.transaction('rw', db.outbox, async () => {
        for (const op of batch) {
          if (!op.sentAt) await db.outbox.update(op.seq!, { sentAt });
        }
      });
      const body = batch.map(wire);
      const info: LastSyncInfo = {
        at: sentAt,
        outcome: 'ok',
        sent: batch.map((o) => ({ opId: o.opId, type: o.type, entityId: o.entityId })),
        results: [],
        batch: body,
      };

      let results: OpResult[];
      try {
        ({ results } = await api.sync(body));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db.transaction('rw', db.outbox, async () => {
          for (const op of batch) {
            const current = await db.outbox.get(op.seq!);
            if (current) {
              await db.outbox.update(op.seq!, {
                attempts: current.attempts + 1,
                lastError: message,
              });
            }
          }
        });
        await db.setMeta('lastSync', { ...info, outcome: 'failed', error: message });
        throw err;
      }

      for (const result of results) await this.applyResult(result);
      info.results = results.map((r) => ({
        opId: r.opId,
        status: r.status,
        ...(r.status === 'rejected' && { message: r.error.message }),
      }));
      await db.setMeta('lastSync', info);
    }
  }

  /** Per-op result handling (PLAN.md §6 step 2). Each in its own transaction. */
  async applyResult(result: OpResult) {
    const { db, repo } = this.deps;
    await db.transaction('rw', db.outbox, db.inspections, async () => {
      const op = await db.outbox.where('opId').equals(result.opId).first();
      if (!op) return; // Already handled (e.g. a replayed batch from the debug panel).
      const entityId = op.entityId;

      if (result.status === 'applied' || result.status === 'duplicate') {
        await db.outbox.delete(op.seq!);
        const version = result.status === 'applied' ? result.record.version : result.appliedVersion;
        const server: InspectionDto | null = result.record;
        const remaining = await db.outbox.where('entityId').equals(entityId).toArray();
        if (remaining.length) {
          // More local edits are queued: keep them, now based on the version this op produced.
          for (const next of remaining) {
            if (next.type !== 'create') await db.outbox.update(next.seq!, { baseVersion: version });
          }
          await db.inspections.update(entityId, { version });
          return;
        }
        if (!server || server.deletedAt) await db.inspections.delete(entityId);
        else await db.inspections.put(repo.fromServer(server));
        return;
      }

      if (result.status === 'conflict') {
        await db.outbox.update(op.seq!, { parked: true, lastError: 'Conflict with server' });
        await db.inspections.update(entityId, {
          syncState: 'conflict',
          serverCopy: result.serverCopy,
        });
        return;
      }

      // rejected: the server will never accept this change as-is. Drop it (and any follow-ups
      // that build on it), keep the local data visible with the reason.
      const all = await db.outbox.where('entityId').equals(entityId).toArray();
      await db.outbox.bulkDelete(all.map((o) => o.seq!));
      await db.inspections.update(entityId, {
        syncState: 'error',
        syncError: result.error,
        serverCopy: result.serverCopy ?? null,
      });
    });
  }

  private async pull() {
    const { db, api, repo } = this.deps;
    const [sites, template] = await Promise.all([api.sites(), api.template()]);
    const lastPulledAt = (await db.getMeta('lastPulledAt')) ?? null;
    const { inspections, serverTime } = await api.inspections(lastPulledAt);

    await db.transaction('rw', [db.inspections, db.outbox, db.sites, db.meta], async () => {
      await db.sites.clear();
      await db.sites.bulkPut(sites.sites);
      await db.setMeta('template', template.template);

      const queued = new Set((await db.outbox.toArray()).map((o) => o.entityId));
      const seen = new Set<string>();
      for (const dto of inspections) {
        seen.add(dto.id);
        const local = await db.inspections.get(dto.id);
        if (local && (queued.has(dto.id) || local.syncState !== 'synced')) {
          // Never overwrite unsynced local work; keep the newest server copy for resolution.
          if (
            (local.syncState === 'conflict' || local.syncState === 'error') &&
            dto.version > (local.serverCopy?.version ?? 0)
          ) {
            await db.inspections.update(dto.id, { serverCopy: dto });
          }
          continue;
        }
        if (dto.deletedAt) await db.inspections.delete(dto.id);
        else await db.inspections.put(repo.fromServer(dto));
      }

      // A full pull is authoritative for synced rows: drop ones the server no longer shows us.
      if (!lastPulledAt) {
        const stale = await db.inspections
          .filter((r) => r.syncState === 'synced' && !seen.has(r.id) && !queued.has(r.id))
          .primaryKeys();
        await db.inspections.bulkDelete(stale);
      }
      const next = new Date(new Date(serverTime).getTime() - PULL_OVERLAP_MS).toISOString();
      await db.setMeta('lastPulledAt', next);
    });
  }

  /**
   * Debug panel (AC6 demo): resend the exact last batch. Already-applied ops come back as
   * `duplicate` and nothing is written twice. Returns the raw results.
   */
  async replayLastBatch(): Promise<OpResult[]> {
    const { db, api } = this.deps;
    const last = await db.getMeta('lastSync');
    if (!last?.batch.length) return [];
    const { results } = await api.sync(last.batch as Parameters<Api['sync']>[0]);
    for (const result of results) await this.applyResult(result);
    await db.setMeta('lastSync', {
      ...last,
      at: new Date(this.now()).toISOString(),
      outcome: 'ok',
      results: results.map((r) => ({ opId: r.opId, status: r.status })),
    });
    return results;
  }
}
