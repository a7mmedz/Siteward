import { Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { db } from '../db/db';
import { useAuth } from '../auth/AuthProvider';
import { repo } from '../sync';
import type { ChecklistItem, EditableFields, InspectionDto, LocalInspection } from '../lib/types';
import { CombineForm } from '../components/CombineForm';
import { ListSkeleton, Notice, PageHeader, formatEditTime } from '../components/ui';

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

const roleLabel = { inspector: 'Inspector', supervisor: 'Supervisor' } as const;

/**
 * Who made each version and when. Information only: which version wins is the user's choice,
 * and conflicts are detected by version number, never by these times.
 */
function VersionHeader({
  side,
  testId,
  children,
}: {
  side: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2" data-testid={testId}>
      <p className="text-xs font-bold tracking-wide text-muted uppercase">{side}</p>
      <p className="mt-0.5 text-sm">{children}</p>
    </div>
  );
}

function mineByline(editedAt: string, offline: boolean) {
  const parts = ['Edited by you', 'on this device', `${formatEditTime(editedAt)} (device time)`];
  if (offline) parts.push('offline');
  return parts.join(' · ');
}

function serverByline(server: InspectionDto) {
  // Copies cached before updatedBy existed have no author until the next change arrives.
  const who = server.updatedBy
    ? `Edited by ${server.updatedBy.name} (${roleLabel[server.updatedBy.role]})`
    : 'Edited on the server';
  return `${who} · ${formatEditTime(server.updatedAt)}`;
}

/** "Your version" vs "Server version", changed fields highlighted (PLAN.md §6). */
export function ConflictPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const record = useLiveQuery(() => db.inspections.get(id).then((r) => r ?? null), [id]);
  const ops = useLiveQuery(() => db.outbox.where('entityId').equals(id).toArray(), [id]);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  /** The server version "Edit combined" was opened against; null on the comparison screen. */
  const [combineAt, setCombineAt] = useState<number | null>(null);

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
  const combining = combineAt === server.version;
  // A newer server version arrived while combining: back to the comparison, never overwrite.
  const serverMovedOn = combineAt !== null && !combining;

  const editedAt = (ops ?? []).reduce(
    (latest, o) => (o.editedAt > latest ? o.editedAt : latest),
    ops?.length ? '' : record.updatedAt,
  );
  const editedOffline = (ops ?? []).some((o) => o.editedOffline);

  async function saveCombined(fields: EditableFields) {
    setBusy(true);
    try {
      const outcome = await repo.saveCombined(id, fields, combineAt!);
      // 'stale': the live record now shows the newer server copy and serverMovedOn kicks in.
      if (outcome === 'queued') navigate(`/inspections/${id}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

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
      {serverMovedOn ? (
        <Notice tone="warn" title="The server version changed again while you were combining">
          Nothing was saved. Below is the newest server version (v{server.version}). Choose again,
          or edit a new combined version.
        </Notice>
      ) : (
        <Notice tone="warn" title="This inspection changed on the server while you were editing">
          A newer version (v{server.version}) was saved on the server. Nothing has been overwritten.
          Choose which version to keep, or edit a combined version.
        </Notice>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <VersionHeader side="Your version" testId="version-header-mine">
          {mineByline(editedAt, editedOffline)}
        </VersionHeader>
        <VersionHeader side="Server version" testId="version-header-server">
          {serverByline(server)}
        </VersionHeader>
      </div>

      {combining ? (
        <div className="mt-4">
          <h2 className="mb-1 text-lg font-bold">Edit combined</h2>
          <CombineForm
            mine={repo.fieldsOf(record)}
            server={server}
            busy={busy}
            onSave={(fields) => void saveCombined(fields)}
            onCancel={() => setCombineAt(null)}
          />
        </div>
      ) : (
        renderComparison()
      )}
    </section>
  );

  function renderComparison() {
    return (
      <>
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

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
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
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || lockedForMe || !!record!.deletedAt}
            onClick={() => setCombineAt(server.version)}
          >
            Edit combined
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Keep mine sends your version on top of the server’s. Keep server discards your change on
          this device. Edit combined lets you merge the differing fields yourself
          {record!.deletedAt ? ' (not available: you deleted this inspection)' : ''}.
        </p>
      </>
    );
  }
}
