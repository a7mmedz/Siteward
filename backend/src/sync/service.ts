import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Tx } from '../lib/db.js';
import { canAccessInspection, type AuthUser } from '../lib/auth.js';
import { zodDetails, type ErrorDetail } from '../lib/errors.js';
import { toInspectionDto, withInspector, type InspectionDto } from '../lib/serialize.js';
import { createPayloadSchema, updatePayloadSchema } from '../lib/validation.js';

export const MAX_BATCH = 50;

export const syncOpSchema = z.object({
  opId: z.uuid('opId must be a UUID'),
  type: z.enum(['create', 'update', 'delete'], {
    message: 'type must be create, update or delete',
  }),
  entity: z.literal('inspection', { message: 'entity must be "inspection"' }),
  entityId: z.uuid('entityId must be a UUID'),
  baseVersion: z.number().int().positive().nullable(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const syncBodySchema = z.object({
  ops: z
    .array(syncOpSchema, { message: 'ops must be an array' })
    .min(1, 'ops must contain at least one operation')
    .max(MAX_BATCH, `A batch may contain at most ${MAX_BATCH} operations`),
});

export type SyncOp = z.infer<typeof syncOpSchema>;

type RejectionCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'LOCKED';

export type OpResult =
  | { opId: string; status: 'applied'; record: InspectionDto }
  | { opId: string; status: 'duplicate'; appliedVersion: number; record: InspectionDto | null }
  | { opId: string; status: 'conflict'; serverCopy: InspectionDto }
  | {
      opId: string;
      status: 'rejected';
      error: { code: RejectionCode; message: string; details?: ErrorDetail[] };
      serverCopy?: InspectionDto;
    };

/** What is stored in ProcessedOp.result: enough to answer a retry of the same opId. */
type StoredResult = { status: 'applied'; entityId: string; version: number };

const reject = (
  op: SyncOp,
  code: RejectionCode,
  message: string,
  extra: { details?: ErrorDetail[]; serverCopy?: InspectionDto } = {},
): OpResult => ({
  opId: op.opId,
  status: 'rejected',
  error: { code, message, ...(extra.details && { details: extra.details }) },
  ...(extra.serverCopy && { serverCopy: extra.serverCopy }),
});

function invalid(op: SyncOp, error: z.ZodError, serverCopy?: InspectionDto): OpResult {
  const details = zodDetails(error);
  const message = details.length === 1 ? details[0]!.message : 'Some fields are invalid';
  return reject(op, 'VALIDATION_ERROR', message, { details, serverCopy });
}

async function load(tx: Tx, id: string) {
  return tx.inspection.findUnique({ where: { id }, include: withInspector });
}

async function applyCreate(tx: Tx, user: AuthUser, op: SyncOp): Promise<OpResult> {
  const parsed = createPayloadSchema.safeParse(op.payload);
  if (!parsed.success) return invalid(op, parsed.error);
  const data = parsed.data;

  // Client-generated ids make creates naturally idempotent: an existing id is not a second row.
  const existing = await load(tx, op.entityId);
  if (existing) {
    if (!canAccessInspection(user, existing)) {
      return reject(op, 'FORBIDDEN', 'An inspection with this id belongs to someone else');
    }
    return {
      opId: op.opId,
      status: 'duplicate',
      appliedVersion: existing.version,
      record: toInspectionDto(existing),
    };
  }

  const site = await tx.site.findUnique({ where: { id: data.siteId }, select: { id: true } });
  if (!site) {
    return reject(op, 'VALIDATION_ERROR', 'Site not found', {
      details: [{ path: 'siteId', message: 'Site not found' }],
    });
  }

  const row = await tx.inspection.create({
    data: {
      id: op.entityId,
      siteId: data.siteId,
      inspectorId: user.id,
      title: data.title,
      notes: data.notes,
      status: data.status,
      items: data.items,
      version: 1,
    },
    include: withInspector,
  });
  return { opId: op.opId, status: 'applied', record: toInspectionDto(row) };
}

async function applyWrite(tx: Tx, user: AuthUser, op: SyncOp): Promise<OpResult> {
  const current = await load(tx, op.entityId);
  if (!current) return reject(op, 'NOT_FOUND', 'Inspection not found');
  if (!canAccessInspection(user, current)) {
    return reject(op, 'FORBIDDEN', 'You can only change your own inspections');
  }
  // From here on the caller may see the record, so rejections carry the server copy: the client
  // can offer "discard my change" and restore it.
  const serverCopy = toInspectionDto(current);

  let data: z.infer<typeof updatePayloadSchema> | undefined;
  if (op.type === 'update') {
    const parsed = updatePayloadSchema.safeParse(op.payload);
    if (!parsed.success) return invalid(op, parsed.error, serverCopy);
    data = parsed.data;
  }
  if (op.baseVersion === null) {
    return reject(op, 'VALIDATION_ERROR', `baseVersion is required for ${op.type}`, {
      details: [{ path: 'baseVersion', message: `baseVersion is required for ${op.type}` }],
      serverCopy,
    });
  }

  if (current.deletedAt) {
    if (op.type === 'delete') return { opId: op.opId, status: 'applied', record: serverCopy };
    return reject(op, 'NOT_FOUND', 'This inspection was deleted on the server', { serverCopy });
  }
  if (op.baseVersion !== current.version) {
    return { opId: op.opId, status: 'conflict', serverCopy };
  }
  if (user.role === 'inspector' && current.status === 'submitted') {
    return reject(op, 'LOCKED', 'Submitted inspections can only be changed by a supervisor', {
      serverCopy,
    });
  }

  // Compare-and-set on version: a concurrent writer that got there first makes this a conflict.
  const { count } = await tx.inspection.updateMany({
    where: { id: op.entityId, version: op.baseVersion },
    data: {
      ...(data
        ? { title: data.title, notes: data.notes, status: data.status, items: data.items }
        : { deletedAt: new Date() }),
      version: { increment: 1 },
    },
  });
  const row = (await load(tx, op.entityId))!;
  if (count === 0) return { opId: op.opId, status: 'conflict', serverCopy: toInspectionDto(row) };
  return { opId: op.opId, status: 'applied', record: toInspectionDto(row) };
}

async function duplicateOf(
  tx: Tx,
  user: AuthUser,
  op: SyncOp,
  processed: { userId: string; result: Prisma.JsonValue },
): Promise<OpResult> {
  if (processed.userId !== user.id) {
    return reject(op, 'FORBIDDEN', 'This operation id was already used by another user');
  }
  const stored = processed.result as StoredResult;
  const current = await load(tx, stored.entityId);
  return {
    opId: op.opId,
    status: 'duplicate',
    // The version this op produced, so the client can rebase later ops on exactly that version.
    appliedVersion: stored.version,
    record: current && canAccessInspection(user, current) ? toInspectionDto(current) : null,
  };
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Applies one operation in its own transaction (§6 server rules):
 * 1. known opId -> duplicate, 2. validate + authorize -> rejected, 3. create is id-idempotent,
 * 4. update/delete check baseVersion -> conflict, 5. record ProcessedOp in the same transaction.
 * Only applied ops are recorded: conflicts and rejections wrote nothing, so a retry simply
 * re-evaluates them against the current state.
 */
export async function processOp(user: AuthUser, op: SyncOp): Promise<OpResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const processed = await tx.processedOp.findUnique({ where: { opId: op.opId } });
        if (processed) return duplicateOf(tx, user, op, processed);

        const result =
          op.type === 'create' ? await applyCreate(tx, user, op) : await applyWrite(tx, user, op);

        if (result.status === 'applied') {
          const stored: StoredResult = {
            status: 'applied',
            entityId: op.entityId,
            version: result.record.version,
          };
          await tx.processedOp.create({
            data: { opId: op.opId, userId: user.id, result: stored },
          });
        }
        return result;
      });
    } catch (err) {
      // Two requests racing on the same opId (or the same new id): the loser's transaction rolls
      // back, and re-running it finds the winner's row and answers `duplicate`.
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
}

export async function processBatch(user: AuthUser, ops: SyncOp[]): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (const op of ops) results.push(await processOp(user, op));
  return results;
}
