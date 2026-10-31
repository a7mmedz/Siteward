import type { InspectionDto, OpResult } from '../lib/types';

type WireOp = {
  opId: string;
  type: 'create' | 'update' | 'delete';
  entityId: string;
  baseVersion: number | null;
  payload: Record<string, unknown>;
};

export type FailureMode = 'network' | '500' | '401' | 'after';

export const SITE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Harbor',
  address: '1 Quay',
  createdAt: '2026-01-01T00:00:00.000Z',
};
export const TEMPLATE = {
  id: 't',
  name: 'Default',
  items: [
    { id: 'a', label: 'Exits clear' },
    { id: 'b', label: 'PPE worn' },
  ],
};
export const USER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'i@example.test',
  name: 'Ina',
  role: 'inspector' as const,
};
export const SUPERVISOR = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Sara',
  role: 'supervisor' as const,
};
const BY_USER = { id: USER.id, name: USER.name, role: USER.role };

/**
 * An in-memory stand-in for the backend, implementing the same /sync rules (idempotent opIds,
 * id-idempotent creates, version checks) behind a `fetch`-compatible function.
 */
export function createFakeServer() {
  const records = new Map<string, InspectionDto>();
  const processed = new Map<string, { entityId: string; version: number }>();
  const failures: FailureMode[] = [];
  const syncBodies: WireOp[][] = [];
  let clock = Date.parse('2026-06-01T10:00:00.000Z');
  let rejectNext: { code: string; message: string } | null = null;
  let onSync: (() => Promise<void> | void) | null = null;

  const tick = () => new Date((clock += 1000)).toISOString();

  function apply(op: WireOp): OpResult {
    const done = processed.get(op.opId);
    if (done) {
      return {
        opId: op.opId,
        status: 'duplicate',
        appliedVersion: done.version,
        record: records.get(done.entityId) ?? null,
      };
    }
    if (rejectNext) {
      const error = rejectNext;
      rejectNext = null;
      const serverCopy = records.get(op.entityId);
      return { opId: op.opId, status: 'rejected', error, ...(serverCopy && { serverCopy }) };
    }
    const current = records.get(op.entityId);
    let record: InspectionDto;
    if (op.type === 'create') {
      if (current) {
        return {
          opId: op.opId,
          status: 'duplicate',
          appliedVersion: current.version,
          record: current,
        };
      }
      const at = tick();
      record = {
        id: op.entityId,
        siteId: op.payload.siteId as string,
        inspectorId: USER.id,
        inspectorName: USER.name,
        title: op.payload.title as string,
        notes: op.payload.notes as string,
        status: op.payload.status as InspectionDto['status'],
        items: op.payload.items as InspectionDto['items'],
        version: 1,
        createdAt: at,
        updatedAt: at,
        updatedBy: BY_USER,
        deletedAt: null,
      };
    } else {
      if (!current) {
        return { opId: op.opId, status: 'rejected', error: { code: 'NOT_FOUND', message: 'nope' } };
      }
      if (op.baseVersion !== current.version) {
        return { opId: op.opId, status: 'conflict', serverCopy: current };
      }
      record =
        op.type === 'delete'
          ? {
              ...current,
              deletedAt: tick(),
              version: current.version + 1,
              updatedAt: tick(),
              updatedBy: BY_USER,
            }
          : {
              ...current,
              ...(op.payload as Partial<InspectionDto>),
              version: current.version + 1,
              updatedAt: tick(),
              updatedBy: BY_USER,
            };
    }
    records.set(record.id, record);
    processed.set(op.opId, { entityId: record.id, version: record.version });
    return { opId: op.opId, status: 'applied', record };
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    if (path === '/sync') {
      const body = JSON.parse(String(init?.body)) as { ops: WireOp[] };
      syncBodies.push(body.ops);
      await onSync?.();
      const failure = failures.shift();
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === '500') return json(500, { error: { code: 'INTERNAL', message: 'boom' } });
      if (failure === '401') {
        return json(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
      }
      const results = body.ops.map(apply);
      if (failure === 'after') {
        return json(500, { error: { code: 'SIMULATED_FAILURE', message: 'lost response' } });
      }
      return json(200, { results, serverTime: tick() });
    }
    if (failures[0] === 'network') throw new TypeError('Failed to fetch');
    if (path === '/sites') return json(200, { sites: [SITE] });
    if (path === '/checklist-template') return json(200, { template: TEMPLATE });
    if (path === '/inspections') {
      const since = url.searchParams.get('updatedSince');
      const serverTime = tick();
      const list = [...records.values()].filter((r) =>
        since ? r.updatedAt >= since : !r.deletedAt,
      );
      return json(200, { inspections: list, serverTime });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: path } });
  };

  return {
    fetch: fetchImpl,
    records,
    processed,
    syncBodies,
    /** Queue failures for the next /sync requests, in order. */
    fail: (...modes: FailureMode[]) => failures.push(...modes),
    rejectNext: (error: { code: string; message: string }) => {
      rejectNext = error;
    },
    /** Runs while a /sync request is "in flight" (before the server processes it). */
    duringSync: (fn: (() => Promise<void> | void) | null) => {
      onSync = fn;
    },
    /** A supervisor edit made directly on the server. */
    serverEdit(id: string, patch: Partial<InspectionDto>) {
      const current = records.get(id)!;
      records.set(id, {
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: tick(),
        updatedBy: SUPERVISOR,
      });
    },
  };
}
