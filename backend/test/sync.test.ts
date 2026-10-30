import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db.js';
import { ITEMS, fixture, makeApp, resetDb, tokenFor } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

type F = Awaited<ReturnType<typeof fixture>>;

function fields(overrides: Record<string, unknown> = {}) {
  return { title: 'Morning walk-through', notes: '', status: 'draft', items: ITEMS, ...overrides };
}

function createOp(siteId: string, entityId = randomUUID(), payload: Record<string, unknown> = {}) {
  return {
    opId: randomUUID(),
    type: 'create',
    entity: 'inspection',
    entityId,
    baseVersion: null,
    payload: { siteId, ...fields(payload) },
  };
}

function updateOp(entityId: string, baseVersion: number, payload: Record<string, unknown> = {}) {
  return {
    opId: randomUUID(),
    type: 'update',
    entity: 'inspection',
    entityId,
    baseVersion,
    payload: fields(payload),
  };
}

function sync(f: F, token: string, ops: unknown[]) {
  return request(f.app).post('/api/sync').set('Authorization', `Bearer ${token}`).send({ ops });
}

async function created(f: F, token = f.inspectorToken) {
  const op = createOp(f.site.id);
  const res = await sync(f, token, [op]);
  expect(res.body.results[0].status).toBe('applied');
  return op.entityId;
}

describe('POST /api/sync — create and update (AC2)', () => {
  it('creates an inspection with the client id, version 1, owned by the caller', async () => {
    const f = await fixture();
    const op = createOp(f.site.id, randomUUID(), { title: '  Dock 4 check  ' });
    const res = await sync(f, f.inspectorToken, [op]);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      opId: op.opId,
      status: 'applied',
      record: {
        id: op.entityId,
        title: 'Dock 4 check',
        version: 1,
        inspectorId: f.inspector.id,
        status: 'draft',
      },
    });
    const row = await prisma.inspection.findUniqueOrThrow({ where: { id: op.entityId } });
    expect(row.version).toBe(1);
    expect(await prisma.processedOp.count()).toBe(1);
  });

  it('updates with the right baseVersion and bumps the version', async () => {
    const f = await fixture();
    const id = await created(f);
    const res = await sync(f, f.inspectorToken, [updateOp(id, 1, { notes: 'Gate 2 rusty' })]);
    expect(res.body.results[0]).toMatchObject({
      status: 'applied',
      record: { version: 2, notes: 'Gate 2 rusty' },
    });
  });

  it('applies a batch in order (create then update of the same record)', async () => {
    const f = await fixture();
    const c = createOp(f.site.id);
    const u = updateOp(c.entityId, 1, { title: 'Renamed' });
    const res = await sync(f, f.inspectorToken, [c, u]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'applied',
      'applied',
    ]);
    expect(res.body.results[1].record).toMatchObject({ version: 2, title: 'Renamed' });
  });

  it('submits when every item has a result and failures have comments', async () => {
    const f = await fixture();
    const id = await created(f);
    const items = [
      { ...ITEMS[0], result: 'pass' },
      { ...ITEMS[1], result: 'fail', comment: 'Two workers without helmets' },
    ];
    const res = await sync(f, f.inspectorToken, [updateOp(id, 1, { status: 'submitted', items })]);
    expect(res.body.results[0]).toMatchObject({
      status: 'applied',
      record: { status: 'submitted' },
    });
  });

  it('soft-deletes, bumps the version and hides the record from lists', async () => {
    const f = await fixture();
    const id = await created(f);
    const del = {
      opId: randomUUID(),
      type: 'delete',
      entity: 'inspection',
      entityId: id,
      baseVersion: 1,
      payload: {},
    };
    const res = await sync(f, f.inspectorToken, [del]);
    expect(res.body.results[0].status).toBe('applied');
    expect(res.body.results[0].record.deletedAt).toEqual(expect.any(String));
    expect(res.body.results[0].record.version).toBe(2);
    const list = await request(f.app)
      .get('/api/inspections')
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(list.body.inspections).toHaveLength(0);
  });
});

describe('POST /api/sync — idempotency (AC6)', () => {
  it('replaying the same request returns duplicate and creates no extra row', async () => {
    const f = await fixture();
    const op = createOp(f.site.id);
    const first = await sync(f, f.inspectorToken, [op]);
    const second = await sync(f, f.inspectorToken, [op]);
    expect(first.body.results[0].status).toBe('applied');
    expect(second.body.results[0]).toMatchObject({
      opId: op.opId,
      status: 'duplicate',
      appliedVersion: 1,
      record: { id: op.entityId, version: 1 },
    });
    expect(await prisma.inspection.count()).toBe(1);
    expect(await prisma.processedOp.count()).toBe(1);
  });

  it('replaying an update does not bump the version twice', async () => {
    const f = await fixture();
    const id = await created(f);
    const op = updateOp(id, 1, { notes: 'once' });
    await sync(f, f.inspectorToken, [op]);
    const replay = await sync(f, f.inspectorToken, [op]);
    expect(replay.body.results[0]).toMatchObject({ status: 'duplicate', appliedVersion: 2 });
    const row = await prisma.inspection.findUniqueOrThrow({ where: { id } });
    expect(row.version).toBe(2);
  });

  it('a create with a new opId but an existing id is duplicate-safe', async () => {
    const f = await fixture();
    const id = await created(f);
    const res = await sync(f, f.inspectorToken, [createOp(f.site.id, id)]);
    expect(res.body.results[0]).toMatchObject({ status: 'duplicate', record: { id } });
    expect(await prisma.inspection.count()).toBe(1);
  });

  it('concurrent requests with the same op apply it exactly once', async () => {
    const f = await fixture();
    const op = createOp(f.site.id);
    const responses = await Promise.all([
      sync(f, f.inspectorToken, [op]),
      sync(f, f.inspectorToken, [op]),
      sync(f, f.inspectorToken, [op]),
    ]);
    const statuses = responses.map((r) => r.body.results[0].status).sort();
    expect(statuses).toEqual(['applied', 'duplicate', 'duplicate']);
    expect(await prisma.inspection.count()).toBe(1);
    expect(await prisma.processedOp.count()).toBe(1);
  });

  it("an opId used by another user is not treated as the caller's", async () => {
    const f = await fixture();
    const op = createOp(f.site.id);
    await sync(f, f.inspectorToken, [op]);
    const res = await sync(f, f.otherToken, [op]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
  });
});

describe('POST /api/sync — conflicts (AC7)', () => {
  it('a stale baseVersion returns conflict with the server copy and writes nothing', async () => {
    const f = await fixture();
    const id = await created(f);
    // Supervisor edits first (v1 -> v2).
    const sup = await sync(f, f.supervisorToken, [updateOp(id, 1, { notes: 'Supervisor note' })]);
    expect(sup.body.results[0].status).toBe('applied');
    // Inspector's offline edit was based on v1.
    const res = await sync(f, f.inspectorToken, [updateOp(id, 1, { notes: 'Inspector note' })]);
    expect(res.body.results[0]).toMatchObject({
      status: 'conflict',
      serverCopy: { id, version: 2, notes: 'Supervisor note' },
    });
    const row = await prisma.inspection.findUniqueOrThrow({ where: { id } });
    expect(row.notes).toBe('Supervisor note');
    expect(row.version).toBe(2);
  });

  it('"keep mine" = a new op based on the server version, which applies', async () => {
    const f = await fixture();
    const id = await created(f);
    await sync(f, f.supervisorToken, [updateOp(id, 1, { notes: 'Supervisor note' })]);
    const res = await sync(f, f.inspectorToken, [updateOp(id, 2, { notes: 'Inspector note' })]);
    expect(res.body.results[0]).toMatchObject({
      status: 'applied',
      record: { version: 3, notes: 'Inspector note' },
    });
  });

  it('a stale delete is a conflict too', async () => {
    const f = await fixture();
    const id = await created(f);
    await sync(f, f.supervisorToken, [updateOp(id, 1)]);
    const res = await sync(f, f.inspectorToken, [
      { opId: randomUUID(), type: 'delete', entity: 'inspection', entityId: id, baseVersion: 1 },
    ]);
    expect(res.body.results[0].status).toBe('conflict');
    expect((await prisma.inspection.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
  });
});

describe('POST /api/sync — rejections (AC1, AC9)', () => {
  it("rejects an inspector's write to someone else's inspection", async () => {
    const f = await fixture();
    const theirs = await created(f, f.otherToken);
    const res = await sync(f, f.inspectorToken, [updateOp(theirs, 1, { notes: 'hijack' })]);
    expect(res.body.results[0]).toMatchObject({
      status: 'rejected',
      error: { code: 'FORBIDDEN' },
    });
    expect(res.body.results[0]).not.toHaveProperty('serverCopy');
    const row = await prisma.inspection.findUniqueOrThrow({ where: { id: theirs } });
    expect(row.notes).toBe('');
  });

  it("lets a supervisor edit anyone's inspection", async () => {
    const f = await fixture();
    const id = await created(f);
    const res = await sync(f, f.supervisorToken, [updateOp(id, 1, { notes: 'Reviewed' })]);
    expect(res.body.results[0].status).toBe('applied');
  });

  it('rejects an invalid payload with field details and writes nothing', async () => {
    const f = await fixture();
    const op = createOp(f.site.id, randomUUID(), { title: '   ' });
    const res = await sync(f, f.inspectorToken, [op]);
    expect(res.body.results[0]).toMatchObject({
      status: 'rejected',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Title is required',
        details: [{ path: 'title', message: 'Title is required' }],
      },
    });
    expect(await prisma.inspection.count()).toBe(0);
    expect(await prisma.processedOp.count()).toBe(0);
  });

  it('rejects submitting with unanswered items or uncommented failures', async () => {
    const f = await fixture();
    const id = await created(f);
    const items = [
      { ...ITEMS[0], result: null },
      { ...ITEMS[1], result: 'fail', comment: ' ' },
    ];
    const res = await sync(f, f.inspectorToken, [updateOp(id, 1, { status: 'submitted', items })]);
    expect(res.body.results[0].status).toBe('rejected');
    expect(res.body.results[0].error.details).toEqual([
      {
        path: 'items.0.result',
        message: '"Emergency exits clear" needs a result before submitting',
      },
      { path: 'items.1.comment', message: '"PPE worn" failed: add a comment explaining why' },
    ]);
  });

  it('rejects an unknown site', async () => {
    const f = await fixture();
    const op = { ...createOp(f.site.id), payload: { siteId: randomUUID(), ...fields() } };
    const res = await sync(f, f.inspectorToken, [op]);
    expect(res.body.results[0]).toMatchObject({
      status: 'rejected',
      error: { code: 'VALIDATION_ERROR', message: 'Site not found' },
    });
  });

  it('locks submitted inspections for inspectors but not supervisors', async () => {
    const f = await fixture();
    const id = await created(f);
    const done = ITEMS.map((i) => ({ ...i, result: 'pass' }));
    await sync(f, f.inspectorToken, [updateOp(id, 1, { status: 'submitted', items: done })]);
    const res = await sync(f, f.inspectorToken, [updateOp(id, 2, { notes: 'late edit' })]);
    expect(res.body.results[0]).toMatchObject({
      status: 'rejected',
      error: { code: 'LOCKED' },
      serverCopy: { version: 2, status: 'submitted' },
    });
    const sup = await sync(f, f.supervisorToken, [updateOp(id, 2, { notes: 'Reopened' })]);
    expect(sup.body.results[0]).toMatchObject({ status: 'applied', record: { status: 'draft' } });
  });

  it('one bad op does not block the rest of the batch', async () => {
    const f = await fixture();
    const bad = createOp(f.site.id, randomUUID(), { title: '' });
    const good = createOp(f.site.id);
    const res = await sync(f, f.inspectorToken, [bad, good]);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'rejected',
      'applied',
    ]);
  });

  it('rejects a malformed batch with 400', async () => {
    const f = await fixture();
    const empty = await sync(f, f.inspectorToken, []);
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('ops must contain at least one operation');

    const tooMany = await sync(
      f,
      f.inspectorToken,
      Array.from({ length: 51 }, () => createOp(f.site.id)),
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toBe('A batch may contain at most 50 operations');

    const badEnvelope = await sync(f, f.inspectorToken, [{ ...createOp(f.site.id), opId: 'x' }]);
    expect(badEnvelope.status).toBe(400);
    expect(badEnvelope.body.error.details).toEqual([
      { path: 'ops.0.opId', message: 'opId must be a UUID' },
    ]);
  });

  it('requires authentication', async () => {
    const res = await request(makeApp()).post('/api/sync').send({ ops: [] });
    expect(res.status).toBe(401);
  });
});

describe('demo failure tools (AC8)', () => {
  it('are hidden unless DEMO_TOOLS=true', async () => {
    const f = await fixture();
    const res = await request(f.app)
      .post('/api/dev/fail-next-sync')
      .set('Authorization', `Bearer ${f.supervisorToken}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('are supervisor-only', async () => {
    const f = await fixture();
    const app = makeApp({ demoTools: true });
    const res = await request(app)
      .post('/api/dev/fail-next-sync')
      .set('Authorization', `Bearer ${f.inspectorToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('mode "before" fails the next sync without writing; the retry succeeds', async () => {
    const f = await fixture();
    const app = makeApp({ demoTools: true });
    const supervisorToken = await tokenFor(app, f.supervisor.email);
    await request(app)
      .post('/api/dev/fail-next-sync')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ count: 1 })
      .expect(200, { scheduled: 1, mode: 'before' });
    const op = createOp(f.site.id);
    const send = () =>
      request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${f.inspectorToken}`)
        .send({ ops: [op] });
    const failed = await send();
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('SIMULATED_FAILURE');
    expect(await prisma.inspection.count()).toBe(0);
    const retry = await send();
    expect(retry.body.results[0].status).toBe('applied');
  });

  it('mode "after" applies, loses the response, and the retry is a duplicate', async () => {
    const f = await fixture();
    const app = makeApp({ demoTools: true });
    const supervisorToken = await tokenFor(app, f.supervisor.email);
    await request(app)
      .post('/api/dev/fail-next-sync')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ count: 1, mode: 'after' });
    const op = createOp(f.site.id);
    const send = () =>
      request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${f.inspectorToken}`)
        .send({ ops: [op] });
    expect((await send()).status).toBe(500);
    expect(await prisma.inspection.count()).toBe(1);
    const retry = await send();
    expect(retry.body.results[0].status).toBe('duplicate');
    expect(await prisma.inspection.count()).toBe(1);
  });

  it('FAIL_SYNC_RATE=1 fails every sync', async () => {
    const f = await fixture();
    const app = makeApp({ failSyncRate: 1 });
    const res = await request(app)
      .post('/api/sync')
      .set('Authorization', `Bearer ${f.inspectorToken}`)
      .send({ ops: [createOp(f.site.id)] });
    expect(res.status).toBe(500);
  });
});

describe('API docs (AC10)', () => {
  it('serves Swagger UI and the OpenAPI spec without auth', async () => {
    const app = makeApp();
    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
    const spec = await request(app).get('/api/openapi.json');
    expect(spec.body.openapi).toBe('3.1.0');
    expect(Object.keys(spec.body.paths)).toEqual(
      expect.arrayContaining(['/auth/login', '/sync', '/inspections', '/inspections/{id}']),
    );
  });
});
