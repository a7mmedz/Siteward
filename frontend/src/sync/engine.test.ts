import { afterEach, describe, expect, it, vi } from 'vitest';
import { SitewardDb } from '../db/db';
import { createApi } from '../lib/api';
import { createRepository } from '../data/repository';
import { createFakeServer, SITE, SUPERVISOR, TEMPLATE, USER } from '../test/fakeServer';
import { SyncEngine, backoffMs } from './engine';
import { describeSync, type EngineStatus } from './status';

let counter = 0;
const opened: SitewardDb[] = [];

function setup(opts: { dbName?: string; server?: ReturnType<typeof createFakeServer> } = {}) {
  const server = opts.server ?? createFakeServer();
  const db = new SitewardDb(opts.dbName ?? `test-${++counter}-${Math.random()}`);
  opened.push(db);
  const api = createApi(server.fetch, 'http://api.test/api');
  let online = true;
  const repo = createRepository(db, undefined, () => online);
  let now = Date.parse('2026-06-01T10:00:00.000Z');
  const onAuthRequired = vi.fn();
  const engine = new SyncEngine({
    db,
    api,
    repo,
    isOnline: () => online,
    now: () => now,
    onAuthRequired,
    timers: false,
  });
  return {
    server,
    db,
    repo,
    engine,
    onAuthRequired,
    setOnline: (v: boolean) => (online = v),
    advance: (ms: number) => (now += ms),
    newInspection: () => repo.createInspection(SITE, USER, TEMPLATE),
  };
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await db.delete();
  }
});

describe('push: pending → applied', () => {
  it('creates on the server, then marks the record synced with the server version', async () => {
    const t = setup();
    const local = await t.newInspection();
    expect((await t.db.inspections.get(local.id))!.syncState).toBe('pending');
    expect(await t.db.outbox.count()).toBe(1);

    await t.engine.syncNow();

    expect(t.engine.status.get().phase).toBe('idle');
    expect(await t.db.outbox.count()).toBe(0);
    const synced = (await t.db.inspections.get(local.id))!;
    expect(synced).toMatchObject({ syncState: 'synced', version: 1, title: local.title });
    expect(t.server.records.get(local.id)).toMatchObject({ title: local.title, version: 1 });
  });

  it('stamps the device edit time and whether the edit was made offline', async () => {
    const t = setup();
    const local = await t.newInspection();
    await t.engine.syncNow();
    t.setOnline(false);
    await t.repo.saveInspection(local.id, { notes: 'offline' });
    const [first] = await t.db.outbox.toArray();
    expect(first).toMatchObject({ editedOffline: true });
    t.setOnline(true);
    await new Promise((r) => setTimeout(r, 5));
    await t.repo.saveInspection(local.id, { notes: 'online again' });
    const [merged] = await t.db.outbox.toArray();
    expect(merged!.editedOffline).toBe(true); // one of the coalesced edits was offline
    expect(merged!.editedAt > first!.editedAt).toBe(true);
    expect(merged!.createdAt).toBe(first!.createdAt);
  });

  it('coalesces unsent edits into one op', async () => {
    const t = setup();
    const local = await t.newInspection();
    await t.repo.saveInspection(local.id, { notes: 'one' });
    await t.repo.saveInspection(local.id, { notes: 'two' });
    const ops = await t.db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'create', payload: { notes: 'two' } });

    await t.engine.syncNow();
    expect(t.server.syncBodies).toHaveLength(1);
    expect(t.server.records.get(local.id)!.notes).toBe('two');
  });

  it('an edit made while its op is in flight is queued, rebased and sent next', async () => {
    const t = setup();
    const local = await t.newInspection();
    t.server.duringSync(async () => {
      t.server.duringSync(null);
      await t.repo.saveInspection(local.id, { notes: 'typed during sync' });
    });

    await t.engine.syncNow();

    // Round 1 sent the create; round 2 sent the follow-up update based on version 1.
    expect(t.server.syncBodies.map((b) => b.map((o) => [o.type, o.baseVersion]))).toEqual([
      [['create', null]],
      [['update', 1]],
    ]);
    expect(await t.db.outbox.count()).toBe(0);
    expect(await t.db.inspections.get(local.id)).toMatchObject({
      syncState: 'synced',
      version: 2,
      notes: 'typed during sync',
    });
  });

  it('sends updates with the last known server version as baseVersion', async () => {
    const t = setup();
    const local = await t.newInspection();
    await t.engine.syncNow();
    await t.repo.saveInspection(local.id, { title: 'Renamed' });
    const [op] = await t.db.outbox.toArray();
    expect(op).toMatchObject({ type: 'update', baseVersion: 1 });
    await t.engine.syncNow();
    expect(t.server.records.get(local.id)).toMatchObject({ title: 'Renamed', version: 2 });
  });

  it('deletes: never-synced records vanish locally; synced ones send a delete', async () => {
    const t = setup();
    const draft = await t.newInspection();
    await t.repo.deleteInspection(draft.id);
    expect(await t.db.inspections.count()).toBe(0);
    expect(await t.db.outbox.count()).toBe(0);

    const kept = await t.newInspection();
    await t.engine.syncNow();
    await t.repo.deleteInspection(kept.id);
    expect((await t.db.outbox.toArray())[0]).toMatchObject({ type: 'delete', baseVersion: 1 });
    await t.engine.syncNow();
    expect(await t.db.inspections.get(kept.id)).toBeUndefined();
    expect(t.server.records.get(kept.id)!.deletedAt).not.toBeNull();
  });
});

describe('idempotency: duplicate', () => {
  it('a lost response is retried and answered as duplicate — one server record', async () => {
    const t = setup();
    const local = await t.newInspection();
    t.server.fail('after'); // server applies, response is lost (500)

    await t.engine.syncNow();
    expect(t.engine.status.get().phase).toBe('failed');
    const [op] = await t.db.outbox.toArray();
    expect(op).toMatchObject({ attempts: 1, sentAt: expect.any(String) });
    expect(t.server.records.size).toBe(1);

    await t.engine.syncNow({ manual: true });
    expect(t.server.syncBodies[1]![0]!.opId).toBe(op!.opId); // same opId resent
    expect(t.engine.status.get().phase).toBe('idle');
    expect(t.server.records.size).toBe(1);
    expect(t.server.processed.size).toBe(1);
    expect(await t.db.outbox.count()).toBe(0);
    expect(await t.db.inspections.get(local.id)).toMatchObject({ syncState: 'synced', version: 1 });
  });

  it('a sent op is never modified: later edits append a new op rebased on appliedVersion', async () => {
    const t = setup();
    const local = await t.newInspection();
    t.server.fail('after');
    await t.engine.syncNow();
    await t.repo.saveInspection(local.id, { notes: 'after the lost response' });
    const ops = await t.db.outbox.orderBy('seq').toArray();
    expect(ops.map((o) => o.type)).toEqual(['create', 'update']);

    await t.engine.syncNow({ manual: true });
    expect(t.server.records.get(local.id)).toMatchObject({
      version: 2,
      notes: 'after the lost response',
    });
    expect(await t.db.inspections.get(local.id)).toMatchObject({ syncState: 'synced', version: 2 });
  });

  it('replaying the last batch from the debug panel creates nothing new', async () => {
    const t = setup();
    await t.newInspection();
    await t.engine.syncNow();
    const results = await t.engine.replayLastBatch();
    expect(results.map((r) => r.status)).toEqual(['duplicate']);
    expect(t.server.records.size).toBe(1);
    expect((await t.db.getMeta('lastSync'))!.results[0]!.status).toBe('duplicate');
  });
});

describe('conflicts', () => {
  async function conflicted() {
    const t = setup();
    const local = await t.newInspection();
    await t.engine.syncNow();
    t.server.serverEdit(local.id, { notes: 'supervisor' }); // v2 on the server
    await t.repo.saveInspection(local.id, { notes: 'inspector' }); // based on v1
    await t.engine.syncNow();
    return { t, id: local.id };
  }

  it('marks the record as conflict, stores the server copy and parks the op', async () => {
    const { t, id } = await conflicted();
    const record = (await t.db.inspections.get(id))!;
    expect(record).toMatchObject({ syncState: 'conflict', notes: 'inspector' });
    expect(record.serverCopy).toMatchObject({ version: 2, notes: 'supervisor' });
    const [op] = await t.db.outbox.toArray();
    expect(op!.parked).toBe(true);
    expect(t.server.records.get(id)!.notes).toBe('supervisor'); // nothing overwritten

    // A parked op is not resent by later syncs, and pull does not overwrite the local copy.
    const sent = t.server.syncBodies.length;
    await t.engine.syncNow();
    expect(t.server.syncBodies).toHaveLength(sent);
    expect((await t.db.inspections.get(id))!.notes).toBe('inspector');
    await expect(t.repo.saveInspection(id, { notes: 'x' })).rejects.toThrow(/Resolve/);
  });

  it('keep mine: re-sends my version on top of the server version', async () => {
    const { t, id } = await conflicted();
    await t.repo.keepMine(id);
    const [op] = await t.db.outbox.toArray();
    expect(op).toMatchObject({ type: 'update', baseVersion: 2, parked: false });
    await t.engine.syncNow();
    expect(t.server.records.get(id)).toMatchObject({ notes: 'inspector', version: 3 });
    expect(await t.db.inspections.get(id)).toMatchObject({ syncState: 'synced', version: 3 });
  });

  it('the server copy carries who changed it; the parked op keeps my device edit time', async () => {
    const { t, id } = await conflicted();
    const record = (await t.db.inspections.get(id))!;
    expect(record.serverCopy!.updatedBy).toEqual(SUPERVISOR);
    const [op] = await t.db.outbox.toArray();
    expect(op!.editedAt).toEqual(expect.any(String));
    expect(op!.editedOffline).toBe(false);
  });

  it('edit combined: one new op (new opId) on the server version replaces the parked one', async () => {
    const { t, id } = await conflicted();
    const [parked] = await t.db.outbox.toArray();
    const current = (await t.db.inspections.get(id))!;
    const fields = { ...t.repo.fieldsOf(current), notes: 'inspector + supervisor' };

    expect(await t.repo.saveCombined(id, fields, 2)).toBe('queued');
    const ops = await t.db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'update',
      baseVersion: 2,
      parked: false,
      sentAt: null,
      payload: { notes: 'inspector + supervisor' },
    });
    expect(ops[0]!.opId).not.toBe(parked!.opId);
    expect(await t.db.inspections.get(id)).toMatchObject({
      syncState: 'pending',
      serverCopy: null,
      notes: 'inspector + supervisor',
    });

    await t.engine.syncNow();
    expect(t.server.records.get(id)).toMatchObject({ notes: 'inspector + supervisor', version: 3 });
    expect(await t.db.inspections.get(id)).toMatchObject({ syncState: 'synced', version: 3 });
    expect(await t.db.outbox.count()).toBe(0);
  });

  it('edit combined against an outdated server version changes nothing', async () => {
    const { t, id } = await conflicted();
    const before = await t.db.outbox.toArray();
    const current = (await t.db.inspections.get(id))!;
    expect(await t.repo.saveCombined(id, t.repo.fieldsOf(current), 1)).toBe('stale');
    expect(await t.db.outbox.toArray()).toEqual(before);
    expect((await t.db.inspections.get(id))!.syncState).toBe('conflict');
  });

  it('edit combined that meets yet another server edit becomes a conflict again', async () => {
    const { t, id } = await conflicted();
    const current = (await t.db.inspections.get(id))!;
    await t.repo.saveCombined(id, { ...t.repo.fieldsOf(current), notes: 'combined' }, 2);
    t.server.serverEdit(id, { notes: 'supervisor again' }); // v3 while the combined op waits
    await t.engine.syncNow();
    const record = (await t.db.inspections.get(id))!;
    expect(record).toMatchObject({ syncState: 'conflict', notes: 'combined' });
    expect(record.serverCopy).toMatchObject({ version: 3, notes: 'supervisor again' });
    expect(t.server.records.get(id)!.notes).toBe('supervisor again');
  });

  it('keep server: drops my change and restores the server copy', async () => {
    const { t, id } = await conflicted();
    await t.repo.keepServer(id);
    expect(await t.db.outbox.count()).toBe(0);
    expect(await t.db.inspections.get(id)).toMatchObject({
      syncState: 'synced',
      notes: 'supervisor',
      version: 2,
    });
  });
});

describe('rejections', () => {
  it('marks the record as error with the message and removes its ops', async () => {
    const t = setup();
    const local = await t.newInspection();
    await t.engine.syncNow();
    await t.repo.saveInspection(local.id, { notes: 'bad' });
    t.server.rejectNext({ code: 'LOCKED', message: 'Submitted inspections are locked' });
    await t.engine.syncNow();
    expect(await t.db.outbox.count()).toBe(0);
    const record = (await t.db.inspections.get(local.id))!;
    expect(record).toMatchObject({
      syncState: 'error',
      notes: 'bad',
      syncError: { code: 'LOCKED', message: 'Submitted inspections are locked' },
    });
    expect(record.serverCopy).toMatchObject({ version: 1 });

    await t.repo.keepServer(local.id); // "Discard my change"
    expect(await t.db.inspections.get(local.id)).toMatchObject({ syncState: 'synced', notes: '' });
  });
});

describe('failures and backoff (AC8)', () => {
  it('network errors keep ops queued, count attempts and back off 2s, 4s, 8s… max 60s', async () => {
    const t = setup();
    await t.newInspection();
    t.server.fail('network', '500');

    await t.engine.syncNow();
    let s = t.engine.status.get();
    expect(s).toMatchObject({ phase: 'failed', failures: 1 });
    expect(s.nextRetryAt! - Date.parse('2026-06-01T10:00:00.000Z')).toBe(2000);
    expect(s.lastError).toMatch(/Cannot reach the server/);

    await t.engine.syncNow();
    s = t.engine.status.get();
    expect(s).toMatchObject({ phase: 'failed', failures: 2 });
    expect(s.lastError).toBe('boom');
    const [op] = await t.db.outbox.toArray();
    expect(op).toMatchObject({ attempts: 2, lastError: 'boom' });

    await t.engine.syncNow({ manual: true }); // recovers
    expect(t.engine.status.get()).toMatchObject({ phase: 'idle', failures: 0, lastError: null });
    expect(await t.db.outbox.count()).toBe(0);
    expect(t.server.records.size).toBe(1);

    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000,
    ]);
  });

  it('401 keeps the queue and asks the user to sign in again', async () => {
    const t = setup();
    await t.newInspection();
    t.server.fail('401');
    await t.engine.syncNow();
    expect(t.engine.status.get().phase).toBe('auth');
    expect(t.onAuthRequired).toHaveBeenCalledOnce();
    expect(await t.db.outbox.count()).toBe(1);
    await t.engine.syncNow({ manual: true });
    expect(await t.db.outbox.count()).toBe(0);
  });

  it('does nothing while offline', async () => {
    const t = setup();
    await t.newInspection();
    t.setOnline(false);
    await t.engine.syncNow();
    expect(t.server.syncBodies).toHaveLength(0);
    expect(t.engine.status.get().online).toBe(false);
    t.setOnline(true);
    await t.engine.syncNow();
    expect(t.server.syncBodies).toHaveLength(1);
  });

  it('only one sync runs at a time (lock)', async () => {
    const t = setup();
    await t.newInspection();
    await Promise.all([t.engine.syncNow(), t.engine.syncNow(), t.engine.syncNow()]);
    expect(t.server.syncBodies).toHaveLength(1);
    expect(t.server.records.size).toBe(1);
  });
});

describe('persistence across reloads (AC4)', () => {
  it('records and queued ops survive closing and reopening the database', async () => {
    const name = `reload-${Math.random()}`;
    const server = createFakeServer();
    const first = setup({ dbName: name, server });
    const local = await first.newInspection();
    await first.repo.saveInspection(local.id, { notes: 'offline note' });
    first.db.close();

    const second = setup({ dbName: name, server }); // "page reload"
    expect(await second.db.inspections.get(local.id)).toMatchObject({
      notes: 'offline note',
      syncState: 'pending',
    });
    expect(await second.db.outbox.count()).toBe(1);
    await second.engine.syncNow();
    expect(server.records.get(local.id)!.notes).toBe('offline note');
  });
});

describe('pull', () => {
  it('stores sites, template and server records; applies remote edits and deletes', async () => {
    const t = setup();
    const local = await t.newInspection();
    await t.engine.syncNow();
    expect(await t.db.sites.count()).toBe(1);
    expect(await t.db.getMeta('template')).toMatchObject({ name: 'Default' });

    t.server.serverEdit(local.id, { title: 'Edited by supervisor' });
    await t.engine.syncNow();
    expect(await t.db.inspections.get(local.id)).toMatchObject({
      title: 'Edited by supervisor',
      version: 2,
    });

    t.server.serverEdit(local.id, { deletedAt: '2026-06-01T11:00:00.000Z' });
    await t.engine.syncNow();
    expect(await t.db.inspections.get(local.id)).toBeUndefined();
  });
});

describe('describeSync', () => {
  const base: EngineStatus = {
    online: true,
    phase: 'idle',
    lastSyncAt: null,
    lastError: null,
    nextRetryAt: null,
    failures: 0,
  };
  const none = { pending: 0, conflicts: 0, errors: 0 };

  it('produces the header labels from PLAN.md §3', () => {
    expect(describeSync(base, none).label).toBe('Online · Synced');
    expect(describeSync({ ...base, online: false }, { ...none, pending: 3 }).label).toBe(
      'Offline · 3 pending',
    );
    expect(describeSync({ ...base, phase: 'syncing' }, none).label).toBe('Syncing…');
    expect(describeSync(base, { ...none, conflicts: 1 }).label).toBe('1 conflict');
    expect(describeSync({ ...base, phase: 'failed' }, { ...none, pending: 1 })).toMatchObject({
      label: 'Sync failed · Retry',
      action: 'retry',
    });
    expect(describeSync({ ...base, phase: 'auth' }, none).action).toBe('login');
    expect(describeSync(base, { ...none, pending: 2 }).label).toBe('Online · 2 pending');
  });
});
