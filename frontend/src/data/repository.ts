import type { SitewardDb } from '../db/db';
import type {
  ChecklistTemplate,
  EditableFields,
  InspectionDto,
  LocalInspection,
  OutboxOp,
  OpType,
  Site,
  User,
} from '../lib/types';

/**
 * The only way the UI changes data. Every write updates the local record AND the outbox in one
 * Dexie transaction, so a crash or reload can never leave one without the other.
 *
 * Coalescing rule: consecutive edits to the same record merge into the newest outbox op as long
 * as that op has never been sent. Once an op has been sent it is frozen (it may already have been
 * applied on the server), and later edits append a new op that the sync engine rebases on the
 * version the earlier op produced.
 */
export function createRepository(
  db: SitewardDb,
  onLocalChange: () => void = () => {},
  isOnline: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine !== false,
) {
  const now = () => new Date().toISOString();

  function fieldsOf(r: LocalInspection): EditableFields {
    return { title: r.title, notes: r.notes, status: r.status, items: r.items };
  }

  function payloadFor(type: OpType, r: LocalInspection): Record<string, unknown> {
    if (type === 'delete') return {};
    if (type === 'create') return { siteId: r.siteId, ...fieldsOf(r) };
    return fieldsOf(r);
  }

  async function opsFor(entityId: string) {
    return db.outbox.where('entityId').equals(entityId).sortBy('seq');
  }

  /**
   * Record a change to `record` (already written) in the outbox. Call inside a transaction.
   * Stamps the device time and whether the device was offline, for the conflict screen.
   */
  async function enqueue(record: LocalInspection, kind: 'save' | 'delete') {
    const ops = await opsFor(record.id);
    const last = ops.at(-1);
    const editedAt = now();
    const offline = !isOnline();
    if (last && !last.sentAt && !last.parked) {
      const type: OpType = kind === 'delete' ? 'delete' : last.type;
      await db.outbox.update(last.seq!, {
        type,
        payload: payloadFor(type, record),
        editedAt,
        editedOffline: last.editedOffline || offline,
      });
      return;
    }
    const neverOnServer = record.version === 0;
    const type: OpType =
      kind === 'delete' ? 'delete' : neverOnServer && !last ? 'create' : 'update';
    const op: OutboxOp = {
      opId: crypto.randomUUID(),
      type,
      entity: 'inspection',
      entityId: record.id,
      baseVersion: neverOnServer ? null : record.version,
      payload: payloadFor(type, record),
      createdAt: editedAt,
      editedAt,
      editedOffline: offline,
      attempts: 0,
      lastError: null,
      sentAt: null,
      parked: false,
    };
    await db.outbox.add(op);
  }

  function fromServer(dto: InspectionDto): LocalInspection {
    return { ...dto, syncState: 'synced', serverCopy: null, syncError: null };
  }

  /**
   * Conflict resolution that keeps local data: drop the record's queued ops (including the parked
   * one) and queue a fresh op — new opId — based on the server's current version, all in one
   * transaction. `fields` replaces the local fields first (Edit combined); without it the local
   * version is re-sent as is (Keep mine).
   */
  async function resendOnServerVersion(
    id: string,
    fields?: EditableFields,
    expectedServerVersion?: number,
  ): Promise<'queued' | 'stale' | 'gone'> {
    const outcome = await db.transaction('rw', db.inspections, db.outbox, async () => {
      const current = await db.inspections.get(id);
      if (!current?.serverCopy) return 'gone' as const;
      if (
        expectedServerVersion !== undefined &&
        current.serverCopy.version !== expectedServerVersion
      ) {
        return 'stale' as const;
      }
      const ops = await opsFor(id);
      await db.outbox.bulkDelete(ops.map((o) => o.seq!));
      const record: LocalInspection = {
        ...current,
        ...fields,
        version: current.serverCopy.version,
        syncState: 'pending',
        serverCopy: null,
        syncError: null,
        updatedAt: now(),
      };
      await db.inspections.put(record);
      await enqueue(record, current.deletedAt ? 'delete' : 'save');
      return 'queued' as const;
    });
    if (outcome === 'queued') onLocalChange();
    return outcome;
  }

  return {
    fromServer,
    fieldsOf,

    async createInspection(site: Site, user: User, template: ChecklistTemplate) {
      const at = now();
      const record: LocalInspection = {
        id: crypto.randomUUID(),
        siteId: site.id,
        inspectorId: user.id,
        inspectorName: user.name,
        title: `${site.name} — ${new Date().toLocaleDateString()}`,
        notes: '',
        status: 'draft',
        items: template.items.map((i) => ({ id: i.id, label: i.label, result: null, comment: '' })),
        version: 0,
        createdAt: at,
        updatedAt: at,
        updatedBy: { id: user.id, name: user.name, role: user.role },
        deletedAt: null,
        syncState: 'pending',
        serverCopy: null,
        syncError: null,
      };
      await db.transaction('rw', db.inspections, db.outbox, async () => {
        await db.inspections.add(record);
        await enqueue(record, 'save');
      });
      onLocalChange();
      return record;
    },

    async saveInspection(id: string, fields: Partial<EditableFields>) {
      const saved = await db.transaction('rw', db.inspections, db.outbox, async () => {
        const current = await db.inspections.get(id);
        if (!current) throw new Error('Inspection not found on this device');
        if (current.syncState === 'conflict') {
          throw new Error('Resolve the sync conflict before editing this inspection');
        }
        const record: LocalInspection = {
          ...current,
          ...fields,
          updatedAt: now(),
          syncState: 'pending',
          syncError: null,
        };
        await db.inspections.put(record);
        await enqueue(record, 'save');
        return record;
      });
      onLocalChange();
      return saved;
    },

    async deleteInspection(id: string) {
      await db.transaction('rw', db.inspections, db.outbox, async () => {
        const current = await db.inspections.get(id);
        if (!current) return;
        const ops = await opsFor(id);
        if (current.version === 0 && ops.every((o) => !o.sentAt)) {
          // Never reached the server: forget it entirely.
          await db.outbox.bulkDelete(ops.map((o) => o.seq!));
          await db.inspections.delete(id);
          return;
        }
        const record: LocalInspection = {
          ...current,
          deletedAt: now(),
          updatedAt: now(),
          syncState: 'pending',
          syncError: null,
        };
        await db.inspections.put(record);
        await enqueue(record, 'delete');
      });
      onLocalChange();
    },

    /** Conflict → "Keep mine": re-send my fields based on the server's current version. */
    async keepMine(id: string) {
      await resendOnServerVersion(id);
    },

    /**
     * Conflict → "Edit combined": save the combined fields as a new change based on the server
     * version the user combined against. Returns 'stale' (and changes nothing) if a newer server
     * version arrived meanwhile, so the user sees the conflict again instead of overwriting it.
     */
    async saveCombined(id: string, fields: EditableFields, serverVersion: number) {
      const current = await db.inspections.get(id);
      if (current?.deletedAt) throw new Error('A deleted inspection cannot be combined');
      return resendOnServerVersion(id, fields, serverVersion);
    },

    /** Conflict → "Keep server", or error → "Discard my change": restore the server copy. */
    async keepServer(id: string) {
      await db.transaction('rw', db.inspections, db.outbox, async () => {
        const current = await db.inspections.get(id);
        if (!current) return;
        const ops = await opsFor(id);
        await db.outbox.bulkDelete(ops.map((o) => o.seq!));
        const server = current.serverCopy;
        if (server && !server.deletedAt) await db.inspections.put(fromServer(server));
        else await db.inspections.delete(id);
      });
      onLocalChange();
    },
  };
}

export type Repository = ReturnType<typeof createRepository>;
