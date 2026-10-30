import { z } from 'zod';
import type { EditableFields } from '../lib/types';

// Mirrors backend/src/lib/validation.ts (ADR-008). The server is authoritative.

export const checklistItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1, 'Item label is required').max(200, 'Item label is too long'),
  result: z.enum(['pass', 'fail', 'na']).nullable(),
  comment: z.string().max(1000, 'Comment must be 1000 characters or fewer'),
});

const baseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(120, 'Title must be 120 characters or fewer'),
  notes: z.string().max(5000, 'Notes must be 5000 characters or fewer'),
  status: z.enum(['draft', 'submitted']),
  items: z
    .array(checklistItemSchema)
    .min(1, 'At least one checklist item is required')
    .max(50, 'At most 50 checklist items are allowed'),
});

export const inspectionSchema = baseSchema.superRefine((value, ctx) => {
  if (value.status !== 'submitted') return;
  value.items.forEach((item, index) => {
    if (item.result === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'result'],
        message: `"${item.label}" needs a result before submitting`,
      });
    } else if (item.result === 'fail' && !item.comment.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'comment'],
        message: `"${item.label}" failed: add a comment explaining why`,
      });
    }
  });
});

export type FieldErrors = Record<string, string>;

/** Returns errors keyed by path (`title`, `items.2.comment`, …); empty when valid. */
export function validateInspection(fields: EditableFields): FieldErrors {
  const result = inspectionSchema.safeParse(fields);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    errors[path] ??= issue.message;
  }
  return errors;
}

/** Errors that should block a draft save (a draft may have unanswered items, but not a bad title). */
export function draftErrors(fields: EditableFields): FieldErrors {
  return validateInspection({ ...fields, status: 'draft' });
}

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required'),
});
