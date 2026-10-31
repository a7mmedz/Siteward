import { useRef, useState } from 'react';
import {
  combineErrors,
  editText,
  getPath,
  pick,
  startCombine,
  type ChoiceDiff,
  type CombineDiff,
  type CombineDraft,
  type Side,
} from '../data/combine';
import type { EditableFields } from '../lib/types';
import { Notice } from './ui';

const valueLabel: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  na: 'N/A',
  draft: 'Draft',
  submitted: 'Submitted',
};
const describe = (v: string | null) => (v === null ? 'Not checked' : (valueLabel[v] ?? v));

function Choice({
  diff,
  picked,
  error,
  onPick,
}: {
  diff: ChoiceDiff;
  picked: Side | undefined;
  error?: string;
  onPick: (side: Side) => void;
}) {
  const labelId = `combine-${diff.path}-label`;
  return (
    <div>
      <p id={labelId} className="field-label">
        {diff.path === 'status' ? 'Status' : 'Result'}{' '}
        <span className="font-normal text-muted">(pick one)</span>
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={!!error}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(['mine', 'server'] as const).map((side) => {
          const checked = picked === side;
          return (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onPick(side)}
              className={`flex min-h-11 items-center justify-between gap-2 rounded-md border-2 px-3 text-left text-sm transition-colors ${
                checked
                  ? 'border-primary bg-surface-2 font-semibold text-ink'
                  : 'border-line bg-surface text-muted hover:border-blue-500 hover:text-ink'
              }`}
            >
              <span>{side === 'mine' ? 'Your version' : 'Server version'}</span>
              <span className="font-semibold">{describe(diff[side])}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function TextBox({
  id,
  label,
  hint,
  value,
  rows,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  rows: number;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="-mt-0.5 mb-1 text-xs text-muted">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        rows={rows}
        className="field-input resize-y"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
        }
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** How a differing text box was prefilled (see mergeText). */
function prefillHint(diff: CombineDiff | undefined) {
  if (diff?.kind !== 'text') return undefined;
  if (diff.mine.trim() && diff.server.trim()) {
    return 'Prefilled with your text, a blank line, then the server’s. Edit it down.';
  }
  return `Only ${diff.mine.trim() ? 'your' : 'the server'} version has text here.`;
}

/**
 * Conflict → "Edit combined": edit the fields that differ, then save. Matching fields are not
 * shown and stay as they are. Validation is the same as a normal edit.
 */
export function CombineForm({
  mine,
  server,
  busy,
  onSave,
  onCancel,
}: {
  mine: EditableFields;
  server: EditableFields;
  busy: boolean;
  onSave: (fields: EditableFields) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CombineDraft>(() => startCombine(mine, server));
  const [showErrors, setShowErrors] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errors = showErrors ? combineErrors(draft) : {};
  const errorList = Object.values(errors);

  // Items with any difference get one block: result choice (if it differs) and the comment box
  // (always, so a failed result can be given its required comment here).
  const itemIndexes = [
    ...new Set(
      draft.diffs
        .filter((d) => d.path.startsWith('items.'))
        .map((d) => Number(d.path.split('.')[1])),
    ),
  ];
  const diffAt = (path: string) => draft.diffs.find((d) => d.path === path);

  function save() {
    const problems = combineErrors(draft);
    if (Object.keys(problems).length) {
      setShowErrors(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    onSave(draft.fields);
  }

  const titleDiff = diffAt('title');
  const statusDiff = diffAt('status');
  const notesDiff = diffAt('notes');

  return (
    <div data-testid="combine-form">
      <p className="mb-3 text-sm text-muted">
        Only the fields that differ are shown; everything else stays as it is. Saving sends the
        combined version on top of the server version.
      </p>

      {errorList.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          className="mb-4 outline-none"
          data-testid="combine-errors"
        >
          <Notice
            tone="bad"
            title={`Fix ${errorList.length} ${errorList.length === 1 ? 'problem' : 'problems'} first`}
          >
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {[...new Set(errorList)].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {(titleDiff || statusDiff || notesDiff) && (
        <div className="card mb-4 space-y-4 p-4">
          {titleDiff && (
            <TextBox
              id="combine-title"
              label="Title"
              hint={prefillHint(titleDiff)}
              rows={3}
              value={draft.fields.title}
              error={errors.title}
              onChange={(v) => setDraft((d) => editText(d, 'title', v))}
            />
          )}
          {statusDiff?.kind === 'choice' && (
            <Choice
              diff={statusDiff}
              picked={draft.picked.status}
              error={errors.status}
              onPick={(side) => setDraft((d) => pick(d, 'status', side))}
            />
          )}
          {notesDiff && (
            <TextBox
              id="combine-notes"
              label="Notes"
              hint={prefillHint(notesDiff)}
              rows={5}
              value={draft.fields.notes}
              error={errors.notes}
              onChange={(v) => setDraft((d) => editText(d, 'notes', v))}
            />
          )}
        </div>
      )}

      {itemIndexes.length > 0 && (
        <ol className="card mb-4 divide-y divide-line" aria-label="Checklist items that differ">
          {itemIndexes.map((index) => {
            const item = draft.fields.items[index]!;
            const resultPath = `items.${index}.result`;
            const commentPath = `items.${index}.comment`;
            const resultDiff = diffAt(resultPath);
            const commentDiff = diffAt(commentPath);
            // An unpicked result only holds a placeholder, so don't call the comment required yet.
            const commentRequired =
              item.result === 'fail' &&
              (resultDiff?.kind !== 'choice' || !!draft.picked[resultPath]);
            return (
              <li key={item.id} className="space-y-3 px-4 py-4" data-testid="combine-item">
                <p className="font-semibold">{item.label}</p>
                {resultDiff?.kind === 'choice' && (
                  <Choice
                    diff={resultDiff}
                    picked={draft.picked[resultPath]}
                    error={errors[resultPath]}
                    onPick={(side) => setDraft((d) => pick(d, resultPath, side))}
                  />
                )}
                <TextBox
                  id={`combine-item-${item.id}-comment`}
                  label={`Comment${commentRequired ? ' (required)' : ''}`}
                  hint={prefillHint(commentDiff)}
                  rows={commentDiff ? 4 : 2}
                  value={getPath(draft.fields, commentPath) ?? ''}
                  error={errors[commentPath]}
                  onChange={(v) => setDraft((d) => editText(d, commentPath, v))}
                />
              </li>
            );
          })}
        </ol>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>
          Save combined
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
