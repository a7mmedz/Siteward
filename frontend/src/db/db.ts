import Dexie, { type EntityTable } from 'dexie';
import type { ChecklistTemplate, LocalInspection, OutboxOp, Site, User } from '../lib/types';

export type MetaRow =
  | { key: 'user'; value: User }
  | { key: 'lastPulledAt'; value: string }
  | { key: 'template'; value: ChecklistTemplate }
  | { key: 'lastSync'; value: LastSyncInfo };

export type MetaKey = MetaRow['key'];
export type MetaValue<K extends MetaKey> = Extract<MetaRow, { key: K }>['value'];

/** What the debug panel shows about the most recent push. */
export type LastSyncInfo = {
  at: string;
  outcome: 'ok' | 'failed';
  sent: { opId: string; type: string; entityId: string }[];
  results: { opId: string; status: string; message?: string }[];
  error?: string;
  /** The exact body of the last batch, kept so it can be replayed to demonstrate idempotency. */
  batch: unknown[];
};

export class SitewardDb extends Dexie {
  inspections!: EntityTable<LocalInspection, 'id'>;
  sites!: EntityTable<Site, 'id'>;
  outbox!: EntityTable<OutboxOp, 'seq'>;
  meta!: Dexie.Table<MetaRow, MetaKey>;

  constructor(name = 'siteward') {
    super(name);
    this.version(1).stores({
      inspections: 'id, siteId, status, syncState, updatedAt',
      sites: 'id, name',
      outbox: '++seq, &opId, entityId',
      meta: 'key',
    });
  }

  async getMeta<K extends MetaKey>(key: K): Promise<MetaValue<K> | undefined> {
    const row = await this.meta.get(key);
    return row?.value as MetaValue<K> | undefined;
  }

  async setMeta<K extends MetaKey>(key: K, value: MetaValue<K>) {
    await this.meta.put({ key, value } as MetaRow);
  }

  /** Wipe all local data (sign-out, or a different user signing in on this device). */
  async clearAll() {
    await this.transaction(
      'rw',
      [this.inspections, this.sites, this.outbox, this.meta],
      async () => {
        await Promise.all([
          this.inspections.clear(),
          this.sites.clear(),
          this.outbox.clear(),
          this.meta.clear(),
        ]);
      },
    );
  }
}

export const db = new SitewardDb();
