import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Role } from '@prisma/client';
import { loadConfig, type Config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { prisma } from '../src/lib/db.js';

export const PASSWORD = 'correct-horse-battery';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

export function makeApp(overrides: Partial<Config> = {}) {
  const config = { ...loadConfig(), loginRateLimit: 10_000, ...overrides };
  return createApp(config, createLogger('silent'));
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "ProcessedOp", "Inspection", "ChecklistTemplate", "Site", "User" CASCADE',
  );
}

export async function createUser(role: Role, name = `${role} ${randomUUID().slice(0, 6)}`) {
  return prisma.user.create({
    data: {
      email: `${randomUUID().slice(0, 8)}@example.test`,
      name,
      role,
      passwordHash: PASSWORD_HASH,
    },
  });
}

export async function tokenFor(app: ReturnType<typeof makeApp>, email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token as string;
}

export async function createSite(name = 'Test site') {
  return prisma.site.create({ data: { name, address: '1 Test Street' } });
}

export const ITEMS = [
  { id: 'exits', label: 'Emergency exits clear', result: null, comment: '' },
  { id: 'ppe', label: 'PPE worn', result: null, comment: '' },
];

export async function insertInspection(siteId: string, inspectorId: string, title = 'Inspection') {
  return prisma.inspection.create({
    data: { id: randomUUID(), siteId, inspectorId, title, status: 'draft', items: ITEMS },
  });
}

/** Two users, one site, and tokens for each: the usual fixture for API tests. */
export async function fixture() {
  const app = makeApp();
  const inspector = await createUser('inspector', 'Ina Inspector');
  const other = await createUser('inspector', 'Oscar Other');
  const supervisor = await createUser('supervisor', 'Sue Supervisor');
  const site = await createSite();
  return {
    app,
    site,
    inspector,
    other,
    supervisor,
    inspectorToken: await tokenFor(app, inspector.email),
    otherToken: await tokenFor(app, other.email),
    supervisorToken: await tokenFor(app, supervisor.email),
  };
}
