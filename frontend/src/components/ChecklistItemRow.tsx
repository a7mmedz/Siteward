import { useState } from 'react';
import type { ChecklistItem, ItemResult } from '../lib/types';
import { CheckIcon, MinusIcon, XIcon } from './icons';

const options: {
  value: ItemResult;
  label: string;
  icon: typeof CheckIcon;
  on: string;
}[] = [
  { value: 'pass', label: 'Pass', icon: CheckIcon, on: 'border-ok bg-ok-tint text-ok-ink' },
  { value: 'fail', label: 'Fail', icon: XIcon, on: 'border-bad bg-bad-tint text-bad-ink' },
  { value: 'na', label: 'N/A', icon: MinusIcon, on: 'border-warn bg-warn-tint text-warn-ink' },
];

export function ChecklistItemRow({
  item,
  index,
  readOnly,
  errors,
  onChange,
}: {
  item: ChecklistItem;
  index: number;
  readOnly: boolean;
  errors: { result?: string; comment?: string };
  onChange: (next: ChecklistItem) => void;
}) {
  const [showComment, setShowComment] = useState(false);
  const commentVisible = showComment || item.result === 'fail' || item.comment !== '';
  const labelId = `item-${item.id}-label`;
  const commentId = `item-${item.id}-comment`;

  return (
    <li className="px-4 py-4" data-testid="checklist-item" id={`item-${item.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p id={labelId} className="font-medium sm:pt-2.5">
          <span className="mr-2 text-sm text-muted tabular-nums">{index + 1}.</span>
          {item.label}
        </p>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-invalid={!!errors.result}
          className="grid shrink-0 grid-cols-3 gap-2"
        >
          {options.map((o) => {
            const checked = item.result === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={readOnly}
                onClick={() => onChange({ ...item, result: checked ? null : o.value })}
                className={`inline-flex min-h-11 min-w-20 items-center justify-center gap-1.5 rounded-md border-2 px-3 text-sm font-semibold transition-colors disabled:cursor-default ${
                  checked
                    ? o.on
                    : `border-line bg-surface text-muted ${readOnly ? '' : 'hover:border-blue-500 hover:text-ink'}`
                } ${readOnly && !checked ? 'opacity-60' : ''}`}
              >
                <o.icon size={16} strokeWidth={2.5} />
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {errors.result && <p className="field-error">{errors.result}</p>}

      {commentVisible ? (
        <div className="mt-3">
          <label htmlFor={commentId} className="field-label">
            Comment{item.result === 'fail' && <span className="text-bad-ink"> (required)</span>}
          </label>
          <textarea
            id={commentId}
            rows={2}
            readOnly={readOnly}
            className="field-input resize-y"
            value={item.comment}
            placeholder={item.result === 'fail' ? 'What is wrong, where, and how serious?' : ''}
            onChange={(e) => onChange({ ...item, comment: e.target.value })}
            aria-invalid={!!errors.comment}
            aria-describedby={errors.comment ? `${commentId}-error` : undefined}
          />
          {errors.comment && (
            <p id={`${commentId}-error`} className="field-error">
              {errors.comment}
            </p>
          )}
        </div>
      ) : (
        !readOnly && (
          <button
            type="button"
            className="mt-2 -ml-1 min-h-9 px-1 text-sm font-semibold text-primary hover:underline"
            onClick={() => setShowComment(true)}
          >
            Add comment
          </button>
        )
      )}
    </li>
  );
}
