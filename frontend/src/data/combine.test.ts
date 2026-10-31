import { describe, expect, it } from 'vitest';
import type { EditableFields } from '../lib/types';
import { combineErrors, editText, mergeText, pick, startCombine } from './combine';

const base: EditableFields = {
  title: 'Harbor walk-through',
  notes: '',
  status: 'draft',
  items: [
    { id: 'a', label: 'Exits clear', result: 'pass', comment: '' },
    { id: 'b', label: 'PPE worn', result: null, comment: '' },
  ],
};

const withItem = (index: number, patch: Partial<EditableFields['items'][number]>) => ({
  ...base,
  items: base.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
});

describe('mergeText', () => {
  it('puts mine first, a blank line, then the server text', () => {
    expect(mergeText('Gate 2 hinge broken', 'Re-check gate 2')).toBe(
      'Gate 2 hinge broken\n\nRe-check gate 2',
    );
  });
  it('does not add blank lines around an empty side', () => {
    expect(mergeText('', 'server')).toBe('server');
    expect(mergeText('mine', '  ')).toBe('mine');
  });
});

describe('startCombine', () => {
  it('lists only differing fields and leaves matching ones as they are', () => {
    const draft = startCombine({ ...base, notes: 'mine' }, { ...base, notes: 'server' });
    expect(draft.diffs.map((d) => d.path)).toEqual(['notes']);
    expect(draft.fields).toEqual({ ...base, notes: 'mine\n\nserver' });
    expect(combineErrors(draft)).toEqual({});
  });

  it('prefills differing item comments with both texts', () => {
    const draft = startCombine(
      withItem(1, { comment: 'mine' }),
      withItem(1, { comment: 'theirs' }),
    );
    expect(draft.diffs).toEqual([
      expect.objectContaining({ kind: 'text', path: 'items.1.comment' }),
    ]);
    expect(draft.fields.items[1]!.comment).toBe('mine\n\ntheirs');
  });

  it('never combines a differing result: Save is blocked until one side is picked', () => {
    const draft = startCombine(withItem(1, { result: 'pass' }), withItem(1, { result: 'na' }));
    expect(draft.diffs).toEqual([
      { kind: 'choice', path: 'items.1.result', label: 'PPE worn', mine: 'pass', server: 'na' },
    ]);
    expect(combineErrors(draft)).toEqual({ 'items.1.result': 'Choose a result for "PPE worn"' });
    const picked = pick(draft, 'items.1.result', 'mine');
    expect(picked.fields.items[1]!.result).toBe('pass');
    expect(combineErrors(picked)).toEqual({});
  });

  it('treats a differing status as a choice too', () => {
    const done = { ...base, items: base.items.map((i) => ({ ...i, result: 'pass' as const })) };
    const draft = startCombine({ ...done, status: 'submitted' }, done);
    expect(combineErrors(draft)).toEqual({ status: 'Choose which status to keep' });
    expect(pick(draft, 'status', 'mine').fields.status).toBe('submitted');
  });

  it('applies normal validation: a failed item needs a comment when submitting', () => {
    const mine: EditableFields = {
      ...base,
      status: 'submitted',
      items: [base.items[0]!, { ...base.items[1]!, result: 'fail' }],
    };
    const server: EditableFields = {
      ...mine,
      items: [base.items[0]!, { ...base.items[1]!, result: 'pass' }],
    };
    let draft = pick(startCombine(mine, server), 'items.1.result', 'mine');
    expect(combineErrors(draft)).toEqual({
      'items.1.comment': '"PPE worn" failed: add a comment explaining why',
    });
    draft = editText(draft, 'items.1.comment', 'Two workers without helmets');
    expect(combineErrors(draft)).toEqual({});
  });

  it('requires the combined title to be edited down to one line', () => {
    const draft = startCombine({ ...base, title: 'Mine' }, { ...base, title: 'Theirs' });
    expect(draft.fields.title).toBe('Mine\n\nTheirs');
    expect(combineErrors(draft).title).toMatch(/single line/);
    expect(combineErrors(editText(draft, 'title', 'Mine and theirs'))).toEqual({});
  });
});
