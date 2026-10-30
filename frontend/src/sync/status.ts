export type SyncPhase = 'idle' | 'syncing' | 'failed' | 'auth';

export type EngineStatus = {
  online: boolean;
  phase: SyncPhase;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Epoch ms of the next automatic retry after a failure. */
  nextRetryAt: number | null;
  /** Consecutive failed runs (drives the backoff). */
  failures: number;
};

export type SyncCounts = { pending: number; conflicts: number; errors: number };

export type SyncTone = 'ok' | 'warn' | 'bad' | 'info';

export type SyncSummary = {
  label: string;
  tone: SyncTone;
  action: 'retry' | 'login' | 'conflicts' | 'errors' | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The always-visible header text (PLAN.md §3), most urgent state first. */
export function describeSync(s: EngineStatus, c: SyncCounts): SyncSummary {
  if (!s.online) {
    return {
      label: c.pending ? `Offline · ${c.pending} pending` : 'Offline',
      tone: c.pending ? 'warn' : 'info',
      action: null,
    };
  }
  if (s.phase === 'syncing') return { label: 'Syncing…', tone: 'info', action: null };
  if (s.phase === 'auth') return { label: 'Sign in to sync', tone: 'bad', action: 'login' };
  if (c.conflicts)
    return { label: plural(c.conflicts, 'conflict'), tone: 'bad', action: 'conflicts' };
  if (s.phase === 'failed') return { label: 'Sync failed · Retry', tone: 'bad', action: 'retry' };
  if (c.errors)
    return { label: plural(c.errors, 'change') + ' rejected', tone: 'bad', action: 'errors' };
  if (c.pending) return { label: `Online · ${c.pending} pending`, tone: 'warn', action: null };
  return { label: 'Online · Synced', tone: 'ok', action: null };
}

export function createStatusStore(initial: EngineStatus) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<EngineStatus>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type StatusStore = ReturnType<typeof createStatusStore>;
