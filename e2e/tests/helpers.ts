import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { API_URL, E2E_ENV } from '../playwright.config';

/** Unique per run, so titles never collide with rows left by earlier runs. */
export const RUN = Date.now().toString(36).slice(-5);

export const USERS = {
  inspector: { email: 'inspector@siteward.test', password: E2E_ENV.SEED_INSPECTOR_PASSWORD },
  supervisor: { email: 'supervisor@siteward.test', password: E2E_ENV.SEED_SUPERVISOR_PASSWORD },
};

const EVIDENCE = fileURLToPath(new URL('../../docs/evidence/', import.meta.url));
mkdirSync(EVIDENCE, { recursive: true });

/** Screenshot into docs/evidence/ (linked from the README). */
export async function evidence(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE}${name}.png` });
}

export const syncStatus = (page: Page) => page.getByTestId('sync-status');

export async function expectSynced(page: Page) {
  await expect(syncStatus(page)).toHaveText('Online · Synced');
}

export async function login(page: Page, who: keyof typeof USERS) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(USERS[who].email);
  await page.getByLabel('Password').fill(USERS[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sites', exact: true })).toBeVisible();
  await expectSynced(page);
}

/** Wait until the service worker controls the page (needed before going offline). */
export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
    timeout: 20_000,
  });
}

/** Create an inspection at a site from the Sites screen; returns its id. */
export async function newInspection(page: Page, site: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `New inspection at ${site}` }).click();
  await page.waitForURL(/\/inspections\/[0-9a-f-]{36}$/);
  return page.url().split('/').pop()!;
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device');
}

export async function setResult(page: Page, index: number, result: 'Pass' | 'Fail' | 'N/A') {
  await page.getByTestId('checklist-item').nth(index).getByRole('radio', { name: result }).click();
}

/** The local IndexedDB copy of an inspection. */
export async function localRecord(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('siteward');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<Record<string, unknown> | undefined>((resolve) => {
      const req = db.transaction('inspections').objectStore('inspections').get(id);
      req.onsuccess = () => resolve(req.result);
    });
  }, id);
}

export async function apiToken(request: APIRequestContext, who: keyof typeof USERS) {
  const res = await request.post(`${API_URL}/auth/login`, { data: USERS[who] });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

type ServerInspection = {
  id: string;
  title: string;
  notes: string;
  status: string;
  version: number;
  items: { id: string; label: string; result: string | null; comment: string }[];
  inspectorName: string;
  updatedAt: string;
  updatedBy: { id: string; name: string; role: string };
};

export async function serverInspection(request: APIRequestContext, token: string, id: string) {
  const res = await request.get(`${API_URL}/inspections/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), `GET /inspections/${id}`).toBe(200);
  return ((await res.json()) as { inspection: ServerInspection }).inspection;
}

export async function serverInspections(request: APIRequestContext, token: string) {
  const res = await request.get(`${API_URL}/inspections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { inspections: ServerInspection[] }).inspections;
}

/** A supervisor edit made directly through the API (another device). */
export async function supervisorEdit(
  request: APIRequestContext,
  id: string,
  change: Partial<ServerInspection> | ((current: ServerInspection) => Partial<ServerInspection>),
) {
  const token = await apiToken(request, 'supervisor');
  const current = await serverInspection(request, token, id);
  const patch = typeof change === 'function' ? change(current) : change;
  const res = await request.post(`${API_URL}/sync`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      ops: [
        {
          opId: crypto.randomUUID(),
          type: 'update',
          entity: 'inspection',
          entityId: id,
          baseVersion: current.version,
          payload: {
            title: current.title,
            notes: current.notes,
            status: current.status,
            items: current.items,
            ...patch,
          },
        },
      ],
    },
  });
  const body = (await res.json()) as { results: { status: string }[] };
  expect(body.results[0]!.status).toBe('applied');
}

export async function failNextSync(
  request: APIRequestContext,
  count: number,
  mode: 'before' | 'after',
) {
  const token = await apiToken(request, 'supervisor');
  const res = await request.post(`${API_URL}/dev/fail-next-sync`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { count, mode },
  });
  expect(res.ok()).toBeTruthy();
}

/** The fields that must match between client and server after a sync (AC5). */
export function comparable(r: Record<string, unknown>) {
  return { title: r.title, notes: r.notes, status: r.status, items: r.items, version: r.version };
}
