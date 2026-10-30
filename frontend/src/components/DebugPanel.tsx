import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { api, engine, useEngineStatus } from '../sync';
import type { OpResult } from '../lib/types';

const FLAG = 'siteward.debug';
const short = (id: string) => id.slice(0, 8);

function useDebugFlag() {
  const { search } = useLocation();
  const [on, setOn] = useState(() => {
    try {
      return sessionStorage.getItem(FLAG) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const value = new URLSearchParams(search).get('debug');
    if (value === null) return;
    const next = value === '1';
    setOn(next);
    try {
      if (next) sessionStorage.setItem(FLAG, '1');
      else sessionStorage.removeItem(FLAG);
    } catch {
      // Storage unavailable: the flag just won't survive navigation.
    }
  }, [search]);
  return on;
}

/** Hidden behind ?debug=1 (PLAN.md §6): outbox, last sync, replay (AC6), failure demo (AC8). */
export function DebugPanel() {
  const on = useDebugFlag();
  const [open, setOpen] = useState(true);
  const status = useEngineStatus();
  const { user } = useAuth();
  const outbox = useLiveQuery(() => db.outbox.orderBy('seq').toArray(), []);
  const lastSync = useLiveQuery(() => db.getMeta('lastSync'), []);
  const [replay, setReplay] = useState<OpResult[] | string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!on) return null;

  async function replayLast() {
    setReplay(null);
    try {
      setReplay(await engine.replayLastBatch());
    } catch (err) {
      setReplay(err instanceof Error ? err.message : String(err));
    }
  }

  async function failNext(mode: 'before' | 'after') {
    try {
      const r = await api.devFailNextSync(1, mode);
      setMessage(`Next sync will fail (${r.mode}).`);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.body.message : String(err));
    }
  }

  return (
    <aside
      aria-label="Debug panel"
      data-testid="debug-panel"
      className="fixed right-2 bottom-16 left-2 z-40 max-h-[60vh] overflow-auto rounded-lg border border-navy-900 bg-navy-900 font-mono text-xs text-blue-50 shadow-xl md:bottom-2 md:left-auto md:w-[28rem]"
    >
      <div className="sticky top-0 flex items-center justify-between bg-navy-900 px-3 py-2">
        <strong className="font-sans text-sm">Debug</strong>
        <button type="button" className="underline" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="space-y-3 px-3 pb-3">
          <section>
            <h3 className="font-bold text-blue-200">Engine</h3>
            <p data-testid="debug-engine">
              phase={status.phase} online={String(status.online)} failures={status.failures}
              {status.nextRetryAt &&
                ` retryIn=${Math.max(0, Math.round((status.nextRetryAt - Date.now()) / 1000))}s`}
            </p>
            {status.lastError && <p className="text-red-300">lastError: {status.lastError}</p>}
          </section>
          <section>
            <h3 className="font-bold text-blue-200">Outbox ({outbox?.length ?? 0})</h3>
            <ul data-testid="debug-outbox">
              {outbox?.map((o) => (
                <li key={o.opId}>
                  {short(o.opId)} {o.type} {short(o.entityId)} base={String(o.baseVersion)} tries=
                  {o.attempts}
                  {o.sentAt ? ' sent' : ''}
                  {o.parked ? ' PARKED' : ''}
                  {o.lastError ? ` err="${o.lastError}"` : ''}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="font-bold text-blue-200">Last sync</h3>
            {lastSync ? (
              <div data-testid="debug-last-sync">
                <p>
                  {lastSync.at} {lastSync.outcome}
                  {lastSync.error ? ` (${lastSync.error})` : ''}
                </p>
                <ul>
                  {lastSync.results.map((r) => (
                    <li key={r.opId}>
                      {short(r.opId)} → {r.status}
                      {r.message ? ` (${r.message})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>none yet</p>
            )}
          </section>
          <div className="flex flex-wrap gap-2 font-sans">
            <button
              type="button"
              className="rounded-sm bg-blue-700 px-2 py-1.5 font-semibold text-white"
              onClick={() => void engine.syncNow({ manual: true })}
            >
              Sync now
            </button>
            <button
              type="button"
              className="rounded-sm bg-blue-700 px-2 py-1.5 font-semibold text-white disabled:opacity-50"
              onClick={() => void replayLast()}
              disabled={!lastSync?.batch.length}
            >
              Force retry last batch
            </button>
            {user?.role === 'supervisor' && (
              <>
                <button
                  type="button"
                  className="rounded-sm border border-blue-200 px-2 py-1.5"
                  onClick={() => void failNext('before')}
                >
                  Fail next sync
                </button>
                <button
                  type="button"
                  className="rounded-sm border border-blue-200 px-2 py-1.5"
                  onClick={() => void failNext('after')}
                >
                  Lose next response
                </button>
              </>
            )}
          </div>
          {message && <p>{message}</p>}
          {replay && (
            <div data-testid="debug-replay">
              <h3 className="font-bold text-blue-200">Replay results</h3>
              {typeof replay === 'string' ? (
                <p className="text-red-300">{replay}</p>
              ) : (
                <ul>
                  {replay.map((r) => (
                    <li key={r.opId}>
                      {short(r.opId)} → {r.status}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
