import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/db.js';
import { fixture, insertInspection, makeApp, resetDb } from './helpers.js';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('access control (AC1)', () => {
  it('inspectors list only their own inspections; supervisors list all', async () => {
    const f = await fixture();
    const mine = await insertInspection(f.site.id, f.inspector.id, 'Mine');
    await insertInspection(f.site.id, f.other.id, 'Theirs');

    const asInspector = await request(f.app)
      .get('/api/inspections')
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(asInspector.status).toBe(200);
    expect(asInspector.body.inspections.map((i: { id: string }) => i.id)).toEqual([mine.id]);
    expect(asInspector.body.inspections[0]).toMatchObject({
      title: 'Mine',
      inspectorName: 'Ina Inspector',
      version: 1,
      status: 'draft',
      deletedAt: null,
    });
    expect(asInspector.body.serverTime).toEqual(expect.any(String));

    const asSupervisor = await request(f.app)
      .get('/api/inspections')
      .set('Authorization', `Bearer ${f.supervisorToken}`);
    expect(asSupervisor.body.inspections).toHaveLength(2);
  });

  it("an inspector cannot read another inspector's inspection by id", async () => {
    const f = await fixture();
    const theirs = await insertInspection(f.site.id, f.other.id);
    const res = await request(f.app)
      .get(`/api/inspections/${theirs.id}`)
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const asOwner = await request(f.app)
      .get(`/api/inspections/${theirs.id}`)
      .set('Authorization', `Bearer ${f.otherToken}`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.inspection.id).toBe(theirs.id);

    const asSupervisor = await request(f.app)
      .get(`/api/inspections/${theirs.id}`)
      .set('Authorization', `Bearer ${f.supervisorToken}`);
    expect(asSupervisor.status).toBe(200);
  });

  it('requires authentication for data routes', async () => {
    const app = makeApp();
    for (const path of ['/api/sites', '/api/inspections', `/api/inspections/${randomUUID()}`]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

describe('GET /api/inspections', () => {
  it('supports incremental pull with updatedSince, including soft deletes', async () => {
    const f = await fixture();
    const old = await insertInspection(f.site.id, f.inspector.id, 'Old');
    await prisma.inspection.update({
      where: { id: old.id },
      data: { updatedAt: new Date('2020-01-01T00:00:00Z') },
    });
    const recent = await insertInspection(f.site.id, f.inspector.id, 'Recent');
    const deleted = await insertInspection(f.site.id, f.inspector.id, 'Deleted');
    await prisma.inspection.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date() },
    });

    const full = await request(f.app)
      .get('/api/inspections')
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(full.body.inspections.map((i: { title: string }) => i.title).sort()).toEqual([
      'Old',
      'Recent',
    ]);

    const since = await request(f.app)
      .get('/api/inspections')
      .query({ updatedSince: '2024-01-01T00:00:00.000Z' })
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    const ids = since.body.inspections.map((i: { id: string }) => i.id);
    expect(ids).toContain(recent.id);
    expect(ids).toContain(deleted.id);
    expect(ids).not.toContain(old.id);
    const deletedDto = since.body.inspections.find((i: { id: string }) => i.id === deleted.id);
    expect(deletedDto.deletedAt).toEqual(expect.any(String));
  });

  it('rejects an invalid updatedSince (AC9)', async () => {
    const f = await fixture();
    const res = await request(f.app)
      .get('/api/inspections')
      .query({ updatedSince: 'yesterday' })
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'updatedSince must be an ISO 8601 date-time',
    });
  });

  it('rejects a non-UUID id', async () => {
    const f = await fixture();
    const res = await request(f.app)
      .get('/api/inspections/123')
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/sites and /api/checklist-template', () => {
  it('lists sites sorted by name', async () => {
    const f = await fixture();
    await prisma.site.create({ data: { name: 'Alpha yard', address: 'A' } });
    const res = await request(f.app)
      .get('/api/sites')
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sites.map((s: { name: string }) => s.name)).toEqual([
      'Alpha yard',
      'Test site',
    ]);
  });

  it('returns the default checklist template', async () => {
    const f = await fixture();
    await prisma.checklistTemplate.create({
      data: { name: 'Default', isDefault: true, items: [{ id: 'a', label: 'A' }] },
    });
    const res = await request(f.app)
      .get('/api/checklist-template')
      .set('Authorization', `Bearer ${f.inspectorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.template).toMatchObject({ name: 'Default', items: [{ id: 'a', label: 'A' }] });
  });
});
