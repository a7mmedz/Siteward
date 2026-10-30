import { expect, test } from '@playwright/test';
import {
  apiToken,
  comparable,
  evidence,
  expectSynced,
  localRecord,
  login,
  newInspection,
  serverInspection,
  setResult,
  syncStatus,
  waitForServiceWorker,
  waitSaved,
  RUN,
} from './helpers';

test.describe('Scenarios 2 & 3 — offline, reload, reconnect (AC3, AC4, AC5)', () => {
  test('works offline across reloads, then syncs and matches the server', async ({
    page,
    context,
    request,
  }) => {
    // One online visit: sign in, create an inspection, let it sync.
    await login(page, 'inspector');
    const existing = await newInspection(page, 'Harbor Logistics Warehouse');
    await page.getByLabel('Title').fill(`Harbor dock 4 — offline test ${RUN}`);
    await waitSaved(page);
    await expectSynced(page);
    await waitForServiceWorker(page);

    // Airplane mode, then reload: the app shell and data come from the device (AC3).
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await expect(syncStatus(page)).toHaveText('Offline');
    await expect(page.getByLabel('Title')).toHaveValue(`Harbor dock 4 — offline test ${RUN}`);
    await page.goto('/inspections');
    await expect(
      page.getByTestId('inspection-row').filter({ hasText: `Harbor dock 4 — offline test ${RUN}` }),
    ).toBeVisible();
    await evidence(page, 'ac3-offline-reload');

    // Edit offline (AC4).
    await page.goto(`/inspections/${existing}`);
    await page.getByLabel('Notes').fill('Edited with no signal.');
    await setResult(page, 0, 'Pass');
    await setResult(page, 1, 'Fail');
    await page
      .getByTestId('checklist-item')
      .nth(1)
      .getByLabel(/Comment/)
      .fill('Extinguisher missing at dock 4.');
    await waitSaved(page);
    await expect(syncStatus(page)).toHaveText('Offline · 1 pending');

    // Create offline (AC4).
    const created = await newInspection(page, 'Riverside Construction Site');
    await page.getByLabel('Title').fill(`Riverside — created offline ${RUN}`);
    await waitSaved(page);
    await expect(syncStatus(page)).toHaveText('Offline · 2 pending');

    // Reload again while offline: everything is still there (AC4).
    await page.reload();
    await expect(page.getByLabel('Title')).toHaveValue(`Riverside — created offline ${RUN}`);
    await page.goto(`/inspections/${existing}`);
    await expect(page.getByLabel('Notes')).toHaveValue('Edited with no signal.');
    await expect(
      page.getByTestId('checklist-item').nth(1).getByRole('radio', { name: 'Fail' }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(syncStatus(page)).toHaveText('Offline · 2 pending');
    await evidence(page, 'ac4-offline-edits-after-reload');

    // Reconnect: pending changes sync automatically (AC5).
    await context.setOffline(false);
    await expectSynced(page);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    await evidence(page, 'ac5-back-online-synced');

    // Server data matches the client (AC5).
    const token = await apiToken(request, 'inspector');
    for (const id of [existing, created]) {
      const local = await localRecord(page, id);
      expect(local?.syncState).toBe('synced');
      const server = await serverInspection(request, token, id);
      expect(comparable(server)).toEqual(comparable(local!));
    }
    expect((await serverInspection(request, token, existing)).notes).toBe('Edited with no signal.');
  });

  test('opens offline straight onto a deep link after the first visit (AC3)', async ({
    page,
    context,
  }) => {
    await login(page, 'inspector');
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.goto('/inspections?status=draft');
    await expect(page.getByRole('heading', { name: 'Inspections' })).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toBeVisible();
  });
});
