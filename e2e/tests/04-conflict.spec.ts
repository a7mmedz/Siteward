import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiToken,
  evidence,
  expectSynced,
  localRecord,
  login,
  newInspection,
  serverInspection,
  supervisorEdit,
  syncStatus,
  waitSaved,
  RUN,
} from './helpers';
import type { APIRequestContext } from '@playwright/test';

async function makeConflict(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
  title: string,
) {
  await login(page, 'inspector');
  const id = await newInspection(page, 'Harbor Logistics Warehouse');
  await page.getByLabel('Title').fill(title);
  await waitSaved(page);
  await expectSynced(page);

  // Inspector goes offline and edits…
  await context.setOffline(true);
  await page.getByLabel('Notes').fill('Inspector: gate 2 hinge broken');
  await waitSaved(page);
  await expect(syncStatus(page)).toHaveText('Offline · 1 pending');

  // …while the supervisor edits the same inspection on the server.
  await supervisorEdit(request, id, { notes: 'Supervisor: re-check gate 2 next week' });

  // Back online: the push is based on an old version → conflict, nothing overwritten.
  await context.setOffline(false);
  await expect(syncStatus(page)).toHaveText('1 conflict');
  return id;
}

test.describe('Scenario 5 — conflicting edits are detected and resolved (AC7)', () => {
  test('keep mine', async ({ page, context, request }) => {
    const id = await makeConflict(page, context, request, `Conflict — keep mine ${RUN}`);
    const token = await apiToken(request, 'inspector');
    expect((await serverInspection(request, token, id)).notes).toBe(
      'Supervisor: re-check gate 2 next week',
    );

    await page.getByRole('link', { name: '1 conflict' }).click();
    await page
      .getByTestId('inspection-row')
      .filter({ hasText: `Conflict — keep mine ${RUN}` })
      .click();
    await expect(page.getByRole('heading', { name: 'Resolve sync conflict' })).toBeVisible();
    const diff = page.getByTestId('conflict-diff');
    await expect(diff).toHaveCount(1);
    await expect(diff).toContainText('Inspector: gate 2 hinge broken');
    await expect(diff).toContainText('Supervisor: re-check gate 2 next week');
    await evidence(page, 'ac7-conflict-screen');

    await page.getByRole('button', { name: 'Keep mine' }).click();
    await expectSynced(page);
    const server = await serverInspection(request, token, id);
    expect(server).toMatchObject({ notes: 'Inspector: gate 2 hinge broken', version: 3 });
    expect(await localRecord(page, id)).toMatchObject({ syncState: 'synced', version: 3 });
    await evidence(page, 'ac7-keep-mine-synced');
  });

  test('keep server', async ({ page, context, request }) => {
    const id = await makeConflict(page, context, request, `Conflict — keep server ${RUN}`);
    await page.goto(`/inspections/${id}`); // the editor redirects to the conflict screen
    await expect(page.getByRole('heading', { name: 'Resolve sync conflict' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep server' }).click();
    await expectSynced(page);
    await expect(page.getByLabel('Notes')).toHaveValue('Supervisor: re-check gate 2 next week');
    const token = await apiToken(request, 'inspector');
    expect(await serverInspection(request, token, id)).toMatchObject({
      notes: 'Supervisor: re-check gate 2 next week',
      version: 2,
    });
  });
});
