import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { createApi } from '../lib/api';
import { createRepository } from '../data/repository';
import { SyncEngine } from './engine';
import { describeSync, type SyncCounts } from './status';

export const api = createApi();

// The engine is created first so the repository can nudge it after each local write.
let engineRef: SyncEngine | null = null;
export const repo = createRepository(db, () => engineRef?.notifyLocalChange());
export const engine = new SyncEngine({ db, api, repo });
engineRef = engine;

export function useEngineStatus() {
  return useSyncExternalStore(engine.status.subscribe, engine.status.get);
}

const EMPTY: SyncCounts = { pending: 0, conflicts: 0, errors: 0 };

export function useSyncCounts(): SyncCounts {
  return (
    useLiveQuery(async () => {
      const [pending, conflicts, errors] = await Promise.all([
        db.outbox.filter((o) => !o.parked).count(),
        db.inspections.where('syncState').equals('conflict').count(),
        db.inspections.where('syncState').equals('error').count(),
      ]);
      return { pending, conflicts, errors };
    }) ?? EMPTY
  );
}

export function useSyncSummary() {
  const status = useEngineStatus();
  const counts = useSyncCounts();
  return { status, counts, summary: describeSync(status, counts) };
}
