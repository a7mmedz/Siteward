import { z } from 'zod';

// Keep these rules in sync with frontend/src/data/validation.ts (ADR-008 in docs/decisions.md).

export const ITEM_RESULTS = ['pass', 'fail', 'na'] as const;
export const INSPECTION_STATUSES = ['draft', 'submitted'] as const;

export const checklistItemSchema = z.object({
  id: z.string().min(1, 'Item id is required').max(64),
  label: z.string().trim().min(1, 'Item label is required').max(200, 'Item label is too long'),
  result: z.enum(ITEM_RESULTS, { message: 'Result must be pass, fail or N/A' }).nullable(),
  comment: z.string().max(1000, 'Comment must be 1000 characters or fewer').default(''),
});

const editableFields = {
  title: z
    .string({ message: 'Title is required' })
    .trim()
    .min(1, 'Title is required')
    .max(120, 'Title must be 120 characters or fewer'),
  notes: z.string().max(5000, 'Notes must be 5000 characters or fewer').default(''),
  status: z.enum(INSPECTION_STATUSES, { message: 'Status must be draft or submitted' }),
  items: z
    .array(checklistItemSchema, { message: 'Checklist items are required' })
    .min(1, 'At least one checklist item is required')
    .max(50, 'At most 50 checklist items are allowed'),
};

type Editable = {
  status: (typeof INSPECTION_STATUSES)[number];
  items: z.infer<typeof checklistItemSchema>[];
};

/** A submitted inspection needs a result for every item, and a comment for every failed item. */
function submitRules(value: Editable, ctx: z.RefinementCtx) {
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
}

export const createPayloadSchema = z
  .object({ siteId: z.uuid('Site id must be a UUID'), ...editableFields })
  .superRefine(submitRules);

export const updatePayloadSchema = z.object(editableFields).superRefine(submitRules);

export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type CreatePayload = z.infer<typeof createPayloadSchema>;
export type UpdatePayload = z.infer<typeof updatePayloadSchema>;
