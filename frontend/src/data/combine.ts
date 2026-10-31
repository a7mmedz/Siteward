import type { ChecklistItem, EditableFields } from '../lib/types';
import { draftErrors, validateInspection, type FieldErrors } from './validation';

/**
 * "Edit combined" on the conflict screen: a form over the fields where the local and the server
 * version differ. Fields that match stay as they are.
 * - Free text (title, notes, item comments): prefilled with mine, a blank line, then the server's.
 * - Choices (status, item results): never combined automatically; the user must pick one side.
 * Paths match the validation paths (`notes`, `items.2.result`, …) so errors land on the field.
 */

export type Side = 'mine' | 'server';

export type TextDiff = { kind: 'text'; path: string; label: string; mine: string; server: string };

export type ChoiceDiff = {
  kind: 'choice';
  path: string;
  label: string;
  mine: string | null;
  server: string | null;
};

export type CombineDiff = TextDiff | ChoiceDiff;

export type CombineDraft = {
  /** The combined result being edited. Unpicked choices hold the server value until picked. */
  fields: EditableFields;
  diffs: CombineDiff[];
  /** Which side was picked for each choice path; missing = not picked yet. */
  picked: Record<string, Side>;
};

/** Both texts, mine first, separated by a blank line; just one if the other is empty. */
export function mergeText(mine: string, server: string) {
  if (!mine.trim()) return server;
  if (!server.trim()) return mine;
  return `${mine}\n\n${server}`;
}

export function startCombine(mine: EditableFields, server: EditableFields): CombineDraft {
  const diffs: CombineDiff[] = [];
  const fields: EditableFields = { ...server, items: [] };

  const text = (path: 'title' | 'notes', label: string) => {
    if (mine[path] === server[path]) return;
    diffs.push({ kind: 'text', path, label, mine: mine[path], server: server[path] });
    fields[path] = mergeText(mine[path], server[path]);
  };
  text('title', 'Title');
  if (mine.status !== server.status) {
    diffs.push({
      kind: 'choice',
      path: 'status',
      label: 'Status',
      mine: mine.status,
      server: server.status,
    });
  }
  text('notes', 'Notes');

  // Server order, then any item only the local version has.
  const mineById = new Map(mine.items.map((i) => [i.id, i]));
  const serverIds = new Set(server.items.map((i) => i.id));
  const pairs: [ChecklistItem | undefined, ChecklistItem | undefined][] = [
    ...server.items.map(
      (s) => [mineById.get(s.id), s] as [ChecklistItem | undefined, ChecklistItem],
    ),
    ...mine.items
      .filter((m) => !serverIds.has(m.id))
      .map((m) => [m, undefined] as [ChecklistItem, undefined]),
  ];
  pairs.forEach(([a, b], index) => {
    const item = { ...(b ?? a)! };
    if (a && b) {
      if (a.result !== b.result) {
        diffs.push({
          kind: 'choice',
          path: `items.${index}.result`,
          label: item.label,
          mine: a.result,
          server: b.result,
        });
      }
      if (a.comment !== b.comment) {
        diffs.push({
          kind: 'text',
          path: `items.${index}.comment`,
          label: `${item.label}: comment`,
          mine: a.comment,
          server: b.comment,
        });
        item.comment = mergeText(a.comment, b.comment);
      }
    }
    fields.items.push(item);
  });

  return { fields, diffs, picked: {} };
}

function setPath(fields: EditableFields, path: string, value: string | null): EditableFields {
  if (path === 'title' || path === 'notes') return { ...fields, [path]: value ?? '' };
  if (path === 'status') return { ...fields, status: value as EditableFields['status'] };
  const [, index, key] = path.split('.');
  return {
    ...fields,
    items: fields.items.map((it, i) => (i === Number(index) ? { ...it, [key!]: value } : it)),
  };
}

export function getPath(fields: EditableFields, path: string): string | null {
  if (path === 'title' || path === 'notes' || path === 'status') return fields[path];
  const [, index, key] = path.split('.');
  const item = fields.items[Number(index)];
  return item ? (item[key as 'result' | 'comment'] ?? null) : null;
}

export function editText(draft: CombineDraft, path: string, value: string): CombineDraft {
  return { ...draft, fields: setPath(draft.fields, path, value) };
}

export function pick(draft: CombineDraft, path: string, side: Side): CombineDraft {
  const diff = draft.diffs.find((d) => d.path === path && d.kind === 'choice');
  if (!diff) return draft;
  return {
    ...draft,
    fields: setPath(draft.fields, path, diff[side]),
    picked: { ...draft.picked, [path]: side },
  };
}

/**
 * Everything that blocks Save, keyed by path: unpicked choices, then the same validation as a
 * normal edit (a submitted inspection needs every result, and a comment on every failure).
 */
export function combineErrors(draft: CombineDraft): FieldErrors {
  const errors: FieldErrors = {};
  for (const d of draft.diffs) {
    if (d.kind === 'choice' && !draft.picked[d.path]) {
      errors[d.path] =
        d.path === 'status' ? 'Choose which status to keep' : `Choose a result for "${d.label}"`;
    }
  }
  const { fields } = draft;
  const rules = fields.status === 'submitted' ? validateInspection(fields) : draftErrors(fields);
  for (const [path, message] of Object.entries(rules)) errors[path] ??= message;
  // The normal editor's title box is one line; the combined title box must be edited down to one.
  if (!errors.title && /[\r\n]/.test(fields.title)) {
    errors.title = 'Title must be a single line: edit the combined text down';
  }
  return errors;
}
