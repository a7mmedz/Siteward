import { expect, test } from '@playwright/test';
import {
  apiToken,
  evidence,
  expectSynced,
  failNextSync,
  login,
  newInspection,
  serverInspection,
  serverInspections,
  syncStatus,
  waitSaved,
} from './helpers';

test.describe('Scenario 4 — replaying the same sync creates no duplicates (AC6)', () => {
  test('a lost response is retried with the same opId and answered as duplicate', async ({
    page,
    request,
  }) => {
    await login(page, 'inspector');
    await page.goto('/?debug=1'); // keep the debug panel open for this session
    const token = await apiToken(request, 'inspector');
    const before = (await serverInspections(request, token)).length;

    // The server applies the next batch and then "loses" the response (HTTP 500).
    await failNextSync(request, 1, 'after');
    const id = await newInspection(page, 'Northgate Office Tower');
    await page.getByLabel('Title').fill('Idempotency check');
    await waitSaved(page);
    await expect(syncStatus(page)).toHaveText('Sync failed · Retry');
    // It reached the server once, even though the client saw a failure.
    expect((await serverInspections(request, token)).length).toBe(before + 1);
    await evidence(page, 'ac6-lost-response');

    // The client retries the same op (automatic backoff after 2 s, or the Retry button): the
    // server answers duplicate, and there is still exactly one row.
    await expectSynced(page);
    await expect(page.getByTestId('debug-last-sync')).toContainText('duplicate');
    expect((await serverInspections(request, token)).length).toBe(before + 1);

    // Replaying the last batch again from the debug panel is also harmless.
    await page.getByRole('button', { name: 'Force retry last batch' }).click();
    await expect(page.getByTestId('debug-replay')).toContainText('duplicate');
    await evidence(page, 'ac6-replay-duplicate');
    const after = await serverInspections(request, token);
    expect(after.length).toBe(before + 1);
    expect(after.filter((i) => i.id === id)).toHaveLength(1);
    expect((await serverInspection(request, token, id)).version).toBe(1);
  });
});
