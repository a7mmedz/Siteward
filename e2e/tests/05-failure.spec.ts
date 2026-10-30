import { expect, test } from '@playwright/test';
import {
  apiToken,
  evidence,
  expectSynced,
  failNextSync,
  login,
  newInspection,
  serverInspection,
  syncStatus,
  waitSaved,
} from './helpers';
import { API_URL } from '../playwright.config';

test.describe('Scenario 6 — failed sync keeps changes queued and recovers (AC8)', () => {
  test('server errors (500): queued, visible, recovers on retry', async ({ page, request }) => {
    await login(page, 'inspector');
    const id = await newInspection(page, 'Northgate Office Tower');
    await page.getByLabel('Title').fill('Failure recovery');
    await waitSaved(page);
    await expectSynced(page);
    const token = await apiToken(request, 'inspector');

    // Next three syncs fail with 500 before touching the database.
    await failNextSync(request, 3, 'before');
    await page.goto(`/inspections/${id}?debug=1`);
    await page.getByLabel('Notes').fill('Saved while the server was failing');
    await waitSaved(page);
    await expect(syncStatus(page)).toHaveText('Sync failed · Retry');
    await expect(page.getByTestId('debug-outbox')).toContainText('update');
    await expect(page.getByTestId('debug-outbox')).toContainText('Simulated server failure');
    expect((await serverInspection(request, token, id)).notes).toBe('');
    await evidence(page, 'ac8-sync-failed-queued');

    // The change survives a reload while still failing.
    await page.reload();
    await expect(page.getByLabel('Notes')).toHaveValue('Saved while the server was failing');

    // Retry until the simulated failures are used up (automatic backoff also retries).
    await expect(async () => {
      if ((await syncStatus(page).textContent()) === 'Sync failed · Retry') {
        await page.getByRole('button', { name: 'Sync failed · Retry' }).click();
      }
      await expect(syncStatus(page)).toHaveText('Online · Synced', { timeout: 3_000 });
    }).toPass({ timeout: 45_000 });
    expect((await serverInspection(request, token, id)).notes).toBe(
      'Saved while the server was failing',
    );
    await evidence(page, 'ac8-recovered');
  });

  test('server unreachable: queued, then recovers when it comes back', async ({
    page,
    request,
  }) => {
    await login(page, 'inspector');
    const id = await newInspection(page, 'Riverside Construction Site');
    await page.getByLabel('Title').fill('Server down');
    await waitSaved(page);
    await expectSynced(page);

    // Simulate the API being down while the browser itself is online.
    await page.route(`${API_URL}/**`, (route) => route.abort('connectionrefused'));
    await page.getByLabel('Notes').fill('Written while the API was down');
    await waitSaved(page);
    await expect(syncStatus(page)).toHaveText('Sync failed · Retry');

    await page.unroute(`${API_URL}/**`);
    await page.getByRole('button', { name: 'Sync failed · Retry' }).click();
    await expectSynced(page);
    const token = await apiToken(request, 'inspector');
    expect((await serverInspection(request, token, id)).notes).toBe(
      'Written while the API was down',
    );
  });
});
