import { Link } from 'react-router';
import { engine, useSyncSummary } from '../sync';
import type { SyncTone } from '../sync/status';
import { CloudOffIcon, RefreshIcon } from './icons';

const dot: Record<SyncTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-blue-500',
};

const pill: Record<SyncTone, string> = {
  ok: 'border-ok/40 bg-ok-tint text-ok-ink',
  warn: 'border-warn/50 bg-warn-tint text-warn-ink',
  bad: 'border-bad/50 bg-bad-tint text-bad-ink',
  info: 'border-line bg-surface-2 text-ink',
};

/** Connection + sync state, always visible in the header (PLAN.md §3). */
export function SyncIndicator() {
  const { status, summary } = useSyncSummary();
  const base = `inline-flex min-h-9 items-center gap-2 rounded-md border px-2.5 text-sm font-medium ${pill[summary.tone]}`;
  const content = (
    <>
      {!status.online ? (
        <CloudOffIcon size={16} />
      ) : status.phase === 'syncing' ? (
        <RefreshIcon size={16} className="animate-spin motion-reduce:animate-none" />
      ) : (
        <span className={`size-2 rounded-full ${dot[summary.tone]}`} aria-hidden="true" />
      )}
      <span data-testid="sync-status">{summary.label}</span>
    </>
  );

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-1">
      {summary.action === 'retry' ? (
        <button
          type="button"
          className={`${base} hover:brightness-95`}
          onClick={() => void engine.syncNow({ manual: true })}
          title={status.lastError ?? undefined}
        >
          {content}
        </button>
      ) : summary.action === 'login' ? (
        <Link to="/login?reauth=1" className={base}>
          {content}
        </Link>
      ) : summary.action === 'conflicts' || summary.action === 'errors' ? (
        <Link to="/inspections?sync=attention" className={base}>
          {content}
        </Link>
      ) : (
        <span className={base}>{content}</span>
      )}
      {status.online && summary.action !== 'retry' && (
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          onClick={() => void engine.syncNow({ manual: true })}
          disabled={status.phase === 'syncing'}
          aria-label="Sync now"
          title="Sync now"
        >
          <RefreshIcon size={16} />
        </button>
      )}
    </div>
  );
}
