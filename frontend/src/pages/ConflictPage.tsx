import { Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { useAuth } from '../auth/AuthProvider';
import { repo } from '../sync';
import type { ChecklistItem, InspectionDto, LocalInspection } from '../lib/types';
import { ListSkeleton, Notice, PageHeader, formatDate } from '../components/ui';

const resultLabel: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' };

type Row = { key: string; label: string; mine: string; theirs: string };

function describeItem(i: ChecklistItem | undefined) {
  if (!i) return '—';
  const result = i.result ? (resultLabel[i.result] ?? i.result) : 'Not checked';
  return i.comment ? `${result} — “${i.comment}”` : result;
}

function diffRows(mine: LocalInspection, server: InspectionDto): Row[] {
  const rows: Row[] = [
    { key: 'title', label: 'Title', mine: mine.title, theirs: server.title },
    {
      key: 'status',
      label: 'Status',
      mine: mine.deletedAt ? 'Deleted' : mine.status,
      theirs: server.status,
    },
    { key: 'notes', label: 'Notes', mine: mine.notes || '—', theirs: server.notes || '—' },
  ];
  const ids = [...new Set([...mine.items, ...server.items].map((i) => i.id))];
  for (const id of ids) {
    const a = mine.items.find((i) => i.id === id);
    const b = server.items.find((i) => i.id === id);
    rows.push({
      key: `item-${id}`,
      label: (a ?? b)!.label,
      mine: describeItem(a),
      theirs: describeItem(b),
    });
  }
  return rows;
}

function Cell({ changed, children, who }: { changed: boolean; children: ReactNode; who: string }) {
  return (
    <div
      className={`rounded-sm px-2 py-1.5 text-sm break-words ${changed ? 'bg-warn-tint text-warn-ink font-medium' : 'text-muted'}`}
    >
      <span className="sr-only">{who}: </span>
      {children}
    </div>
  );
}

/** "Your version" vs "Server version", changed fields highlighted (PLAN.md §6). */
export function ConflictPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const record = useLiveQuery(() => db.inspections.get(id).then((r) => r ?? null), [id]);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (record === undefined) return <ListSkeleton rows={4} label="Loading conflict" />;
  if (record === null) return <Navigate to="/inspections" replace />;
  if (record.syncState !== 'conflict' || !record.serverCopy) {
    return <Navigate to={`/inspections/${id}`} replace />;
  }

  const server = record.serverCopy;
  const rows = diffRows(record, server);
  const changed = rows.filter((r) => r.mine !== r.theirs);
  const visible = showAll ? rows : changed;
  const lockedForMe = user?.role === 'inspector' && server.status === 'submitted';

  async function resolve(choice: 'mine' | 'server') {
    setBusy(true);
    try {
      if (choice === 'mine') await repo.keepMine(id);
      else await repo.keepServer(id);
      navigate(`/inspections/${id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader
        back={{ to: '/inspections', label: 'Inspections' }}
        title="Resolve sync conflict"
        subtitle={record.title}
      />
      <Notice tone="warn" title="This inspection changed on the server while you were editing">
        A newer version was saved on the server (v{server.version}, {formatDate(server.updatedAt)}),
        for example by a supervisor. Nothing has been overwritten. Choose which version to keep.
      </Notice>

      <div className="card mt-4 overflow-hidden">
        <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-line bg-surface-2 px-3 py-2 text-xs font-bold tracking-wide text-muted uppercase">
          <span>Field</span>
          <span>Your version</span>
          <span>Server version</span>
        </div>
        <ul className="divide-y divide-line" aria-label="Differences">
          {visible.map((r) => {
            const isChanged = r.mine !== r.theirs;
            return (
              <li
                key={r.key}
                className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2 px-3 py-2"
                data-testid={isChanged ? 'conflict-diff' : undefined}
              >
                <span className="py-1.5 text-sm font-semibold">{r.label}</span>
                <Cell changed={isChanged} who="Your version">
                  {r.mine}
                </Cell>
                <Cell changed={isChanged} who="Server version">
                  {r.theirs}
                </Cell>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line px-3 py-2">
          <button
            type="button"
            className="min-h-9 text-sm font-semibold text-primary hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? `Show only the ${changed.length} differences` : 'Show all fields'}
          </button>
        </div>
      </div>

      {lockedForMe && (
        <div className="mt-4">
          <Notice tone="info" title="The server version is submitted">
            Only a supervisor can change a submitted inspection, so keeping your version would be
            rejected.
          </Notice>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || lockedForMe}
          onClick={() => void resolve('mine')}
        >
          Keep mine
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void resolve('server')}
        >
          Keep server
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Keep mine sends your version on top of the server’s. Keep server discards your change on
        this device.
      </p>
    </section>
  );
}
