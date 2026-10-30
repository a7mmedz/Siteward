import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../auth/AuthProvider';
import { repo } from '../sync';
import { draftErrors, validateInspection, type FieldErrors } from '../data/validation';
import type { EditableFields, LocalInspection } from '../lib/types';
import { ChecklistItemRow } from '../components/ChecklistItemRow';
import { TrashIcon } from '../components/icons';
import { ListSkeleton, Notice, PageHeader, StatusBadge, SyncBadge } from '../components/ui';

const AUTOSAVE_MS = 500;

/** Short, grouped lines for the summary; the exact message is shown next to each field. */
function summarizeErrors(errors: FieldErrors): string[] {
  const lines: string[] = [];
  let missing = 0;
  let comments = 0;
  for (const [path, message] of Object.entries(errors)) {
    if (path.endsWith('.result')) missing++;
    else if (path.endsWith('.comment')) comments++;
    else lines.push(message);
  }
  if (missing) lines.push(`${missing} ${missing === 1 ? 'item needs' : 'items need'} a result`);
  if (comments) {
    lines.push(`${comments} failed ${comments === 1 ? 'item needs' : 'items need'} a comment`);
  }
  return lines;
}

export function InspectionEditorPage() {
  const { id = '' } = useParams();
  const record = useLiveQuery(() => db.inspections.get(id).then((r) => r ?? null), [id]);
  const site = useLiveQuery(
    () => (record ? db.sites.get(record.siteId) : undefined),
    [record?.siteId],
  );

  if (record === undefined) return <ListSkeleton rows={4} label="Loading inspection" />;
  if (record === null || record.deletedAt) return <Navigate to="/inspections" replace />;
  if (record.syncState === 'conflict')
    return <Navigate to={`/inspections/${id}/conflict`} replace />;
  return <Editor key={record.id} record={record} siteName={site?.name} />;
}

function Editor({ record, siteName }: { record: LocalInspection; siteName?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState<EditableFields>(() => repo.fieldsOf(record));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'invalid'>('saved');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(fields);
  const summaryRef = useRef<HTMLDivElement>(null);

  const isSupervisor = user?.role === 'supervisor';
  const readOnly = record.status === 'submitted' && !isSupervisor;

  // Adopt changes that arrive from sync (e.g. a pull), unless the user has unsaved typing.
  useEffect(() => {
    if (timer.current) return;
    const incoming = repo.fieldsOf(record);
    if (JSON.stringify(incoming) !== JSON.stringify(latest.current)) {
      latest.current = incoming;
      setFields(incoming);
    }
  }, [record]);

  const persist = useCallback(
    async (next: EditableFields) => {
      const problems = next.status === 'submitted' ? validateInspection(next) : draftErrors(next);
      if (Object.keys(problems).length) {
        setErrors(problems);
        setSaveState('invalid');
        return false;
      }
      await repo.saveInspection(record.id, next);
      setSaveState('saved');
      return true;
    },
    [record.id],
  );

  const flush = useCallback(async () => {
    if (!timer.current) return true;
    clearTimeout(timer.current);
    timer.current = null;
    return persist(latest.current);
  }, [persist]);

  // Save anything pending when leaving the screen.
  useEffect(() => () => void flush(), [flush]);

  function update(patch: Partial<EditableFields>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setFields(next);
    setSaveState('unsaved');
    // Clear errors the user has just fixed (keep the rest visible).
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const current = next.status === 'submitted' ? validateInspection(next) : draftErrors(next);
      return Object.fromEntries(Object.entries(prev).filter(([k]) => k in current));
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void persist(latest.current);
    }, AUTOSAVE_MS);
  }

  async function submit() {
    const next: EditableFields = { ...latest.current, status: 'submitted' };
    const problems = validateInspection(next);
    if (Object.keys(problems).length) {
      setErrors(problems);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = next;
    setFields(next);
    if (await persist(next)) navigate('/inspections');
  }

  async function setStatus(status: EditableFields['status']) {
    await flush();
    update({ status });
    await flush();
  }

  const answered = fields.items.filter((i) => i.result !== null).length;
  const errorList = Object.entries(errors);

  return (
    <section className="pb-28">
      <PageHeader
        back={{ to: '/inspections', label: 'Inspections' }}
        title={fields.title || 'Untitled inspection'}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {siteName && <span>{siteName}</span>}
            {isSupervisor && <span>by {record.inspectorName}</span>}
            <StatusBadge status={record.status} />
            <SyncBadge state={record.syncState} />
          </span>
        }
      />

      {record.syncState === 'error' && record.syncError && (
        <div className="mb-4">
          <Notice
            tone="bad"
            title="The server did not accept your last change"
            actions={
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void repo.keepServer(record.id)}
              >
                Discard my change
              </button>
            }
          >
            {record.syncError.message}. Fix it and keep editing to try again, or discard your change
            {record.serverCopy ? ' and restore the server version' : ''}.
          </Notice>
        </div>
      )}
      {readOnly && (
        <div className="mb-4">
          <Notice tone="info" title="Submitted">
            This inspection is submitted and locked. A supervisor can reopen it.
          </Notice>
        </div>
      )}
      {errorList.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          className="mb-4 outline-none"
          data-testid="error-summary"
        >
          <Notice
            tone="bad"
            title={`Fix ${errorList.length} ${errorList.length === 1 ? 'problem' : 'problems'} first`}
          >
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {summarizeErrors(errors).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <div className="card space-y-4 p-4">
        <div>
          <label htmlFor="title" className="field-label">
            Title
          </label>
          <input
            id="title"
            className="field-input"
            value={fields.title}
            readOnly={readOnly}
            maxLength={120}
            onChange={(e) => update({ title: e.target.value })}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'title-error' : undefined}
          />
          {errors.title && (
            <p id="title-error" className="field-error">
              {errors.title}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="notes" className="field-label">
            Notes
          </label>
          <textarea
            id="notes"
            rows={3}
            className="field-input resize-y"
            value={fields.notes}
            readOnly={readOnly}
            placeholder="General observations, people on site, weather…"
            onChange={(e) => update({ notes: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-6 mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-bold">Checklist</h2>
        <span className="text-sm text-muted tabular-nums" aria-live="polite">
          {answered} of {fields.items.length} checked
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-blue-200/60" aria-hidden="true">
        <div
          className="h-full bg-blue-500 transition-[width]"
          style={{ width: `${(answered / Math.max(1, fields.items.length)) * 100}%` }}
        />
      </div>
      <ol className="card divide-y divide-line">
        {fields.items.map((item, index) => (
          <ChecklistItemRow
            key={item.id}
            item={item}
            index={index}
            readOnly={readOnly}
            errors={{
              result: errors[`items.${index}.result`],
              comment: errors[`items.${index}.comment`],
            }}
            onChange={(next) =>
              update({ items: latest.current.items.map((it, i) => (i === index ? next : it)) })
            }
          />
        ))}
      </ol>

      {record.status === 'draft' && (
        <div className="mt-6">
          {confirmDelete ? (
            <Notice
              tone="warn"
              title="Delete this draft?"
              actions={
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={async () => {
                      if (timer.current) clearTimeout(timer.current);
                      timer.current = null;
                      await repo.deleteInspection(record.id);
                      navigate('/inspections', { replace: true });
                    }}
                  >
                    Delete draft
                  </button>
                </>
              }
            >
              This cannot be undone.
            </Notice>
          ) : (
            <button
              type="button"
              className="btn-ghost text-bad-ink"
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon size={18} />
              Delete draft
            </button>
          )}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-line bg-surface/95 backdrop-blur md:bottom-0">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="text-sm text-muted" aria-live="polite" data-testid="save-state">
            {saveState === 'saved'
              ? 'Saved on this device'
              : saveState === 'unsaved'
                ? 'Saving…'
                : 'Not saved: fix the errors above'}
          </span>
          <div className="ml-auto flex gap-2">
            {record.status === 'draft' ? (
              <button type="button" className="btn-primary" onClick={() => void submit()}>
                Submit inspection
              </button>
            ) : isSupervisor ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void setStatus('draft')}
              >
                Reopen as draft
              </button>
            ) : (
              <Link to="/inspections" className="btn-secondary">
                Done
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
