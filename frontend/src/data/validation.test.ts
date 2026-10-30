import { describe, expect, it } from 'vitest';
import { draftErrors, loginSchema, validateInspection } from './validation';
import type { EditableFields } from '../lib/types';

const fields = (overrides: Partial<EditableFields> = {}): EditableFields => ({
  title: 'Dock check',
  notes: '',
  status: 'draft',
  items: [
    { id: 'a', label: 'Exits clear', result: null, comment: '' },
    { id: 'b', label: 'PPE worn', result: null, comment: '' },
  ],
  ...overrides,
});

describe('client validation (AC9)', () => {
  it('accepts a draft with unanswered items', () => {
    expect(validateInspection(fields())).toEqual({});
  });

  it('requires a title', () => {
    expect(draftErrors(fields({ title: '   ' }))).toEqual({ title: 'Title is required' });
  });

  it('blocks submit until every item has a result and failures have comments', () => {
    const errors = validateInspection(
      fields({
        status: 'submitted',
        items: [
          { id: 'a', label: 'Exits clear', result: null, comment: '' },
          { id: 'b', label: 'PPE worn', result: 'fail', comment: '' },
        ],
      }),
    );
    expect(errors).toEqual({
      'items.0.result': '"Exits clear" needs a result before submitting',
      'items.1.comment': '"PPE worn" failed: add a comment explaining why',
    });
  });

  it('validates login input', () => {
    const r = loginSchema.safeParse({ email: 'nope', password: '' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).toEqual([
      'Enter a valid email address',
      'Password is required',
    ]);
  });
});
