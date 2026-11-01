import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  apiToken,
  evidence,
  expectSynced,
  localRecord,
  login,
  newInspection,
  serverInspection,
  setResult,
  supervisorEdit,
  syncStatus,
  waitSaved,
  RUN,
} from './helpers';
import type { APIRequestContext } from '@playwright/test';

const MY_NOTE = 'Inspector: gate 2 hinge broken';
const SUPERVISOR_NOTE = 'Supervisor: re-check gate 2 next week';

type ConflictEdits = {
  /** The inspector's offline edit, made in the UI. */
  mine: (page: Page) => Promise<void>;
  /** The supervisor's online edit, made through the API. */
  theirs: Parameters<typeof supervisorEdit>[2];
};

const notesConflict: ConflictEdits = {
  mine: (page) => page.getByLabel('Notes').fill(MY_NOTE),
  theirs: { notes: SUPERVISOR_NOTE },
};

async function makeConflict(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
  title: string,
  edits: ConflictEdits = notesConflict,
) {
  await login(page, 'inspector');
  const id = await newInspection(page, 'Harbor Logistics Warehouse');
  await page.getByLabel('Title').fill(title);
  await waitSaved(page);
  await expectSynced(page);

  // Inspector goes offline and edits…
  await context.setOffline(true);
  await edits.mine(page);
  await waitSaved(page);
  await expect(syncStatus(page)).toHaveText('Offline · 1 pending');

  // …while the supervisor edits the same inspection on the server.
  await supervisorEdit(request, id, edits.theirs);

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

const TIME = /\d{1,2}:\d{2}/;

test.describe('Scenario 5b — who made each version, and Edit combined (AC7)', () => {
  test('the conflict screen shows both authors and times', async ({ page, context, request }) => {
    const id = await makeConflict(page, context, request, `Conflict — authors ${RUN}`);
    await page.goto(`/inspections/${id}`);
    await expect(page.getByRole('heading', { name: 'Resolve sync conflict' })).toBeVisible();

    const mine = page.getByTestId('version-header-mine');
    await expect(mine).toContainText('Your version');
    await expect(mine).toContainText('Edited by you · on this device ·');
    await expect(mine).toContainText('(device time)');
    await expect(mine).toContainText('offline'); // the edit was made with the network off
    await expect(mine).toContainText(TIME);

    const token = await apiToken(request, 'inspector');
    const server = await serverInspection(request, token, id);
    expect(server.updatedBy).toMatchObject({ name: 'Sam Supervisor', role: 'supervisor' });
    const serverTime = await page.evaluate(
      (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      server.updatedAt,
    );
    await expect(page.getByTestId('version-header-server')).toHaveText(
      `Server versionEdited by Sam Supervisor (Supervisor) · ${serverTime}`,
    );
    await evidence(page, 'ac7-conflict-authors');
  });

  test('edit combined: both notes prefilled, edited, saved and synced', async ({
    page,
    context,
    request,
    browser,
  }) => {
    const id = await makeConflict(page, context, request, `Conflict — combined ${RUN}`);
    await page.goto(`/inspections/${id}`);
    const parked = (await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('siteward');
          req.onsuccess = () => {
            const get = req.result.transaction('outbox').objectStore('outbox').getAll();
            get.onsuccess = () => resolve(get.result);
          };
        }),
    )) as { opId: string; parked: boolean }[];
    expect(parked).toEqual([expect.objectContaining({ parked: true })]);

    await page.getByRole('button', { name: 'Edit combined' }).click();
    const notes = page.getByLabel('Notes');
    await expect(notes).toHaveValue(`${MY_NOTE}\n\n${SUPERVISOR_NOTE}`);
    await evidence(page, 'ac7-edit-combined-form');

    // Cancel goes back with nothing changed; opening again starts from the same prefill.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('conflict-diff')).toHaveCount(1);
    await page.getByRole('button', { name: 'Edit combined' }).click();
    await expect(notes).toHaveValue(`${MY_NOTE}\n\n${SUPERVISOR_NOTE}`);

    const combined = 'Gate 2 hinge broken — supervisor to re-check next week';
    await notes.fill(combined);
    await page.getByRole('button', { name: 'Save combined' }).click();
    await expectSynced(page);
    await expect(page.getByLabel('Notes')).toHaveValue(combined);
    expect(await localRecord(page, id)).toMatchObject({
      syncState: 'synced',
      version: 3,
      notes: combined,
    });
    await evidence(page, 'ac7-edit-combined-synced');

    // The supervisor's view of the server: the combined text, one version above theirs (v2).
    const supToken = await apiToken(request, 'supervisor');
    expect(await serverInspection(request, supToken, id)).toMatchObject({
      notes: combined,
      version: 3,
      updatedBy: { name: 'Ahmed', role: 'inspector' },
    });
    const supervisor = await browser.newPage();
    await login(supervisor, 'supervisor');
    await supervisor.goto(`/inspections/${id}`);
    await expect(supervisor.getByLabel('Notes')).toHaveValue(combined);
    await supervisor.close();
  });

  test('edit combined with a differing result: Save is blocked until one is picked', async ({
    page,
    context,
    request,
  }) => {
    const label = 'Emergency exits clear and signed';
    const id = await makeConflict(page, context, request, `Conflict — result ${RUN}`, {
      mine: (p) => setResult(p, 0, 'Pass'),
      theirs: (current) => ({
        items: current.items.map((it, i) =>
          i === 0 ? { ...it, result: 'fail', comment: 'Exit 3 blocked by pallets' } : it,
        ),
      }),
    });
    await page.goto(`/inspections/${id}`);
    await page.getByRole('button', { name: 'Edit combined' }).click();

    const item = page.getByTestId('combine-item').filter({ hasText: label });
    await expect(item.getByRole('radio', { name: /Your version.*Pass/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(item.getByRole('radio', { name: /Server version.*Fail/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    await page.getByRole('button', { name: 'Save combined' }).click();
    await expect(page.getByTestId('combine-errors')).toContainText(
      `Choose a result for "${label}"`,
    );
    await evidence(page, 'ac7-edit-combined-choice-required');
    // Nothing was written: still a conflict locally, server untouched.
    await expect(syncStatus(page)).toHaveText('1 conflict');
    const token = await apiToken(request, 'inspector');
    expect((await serverInspection(request, token, id)).version).toBe(2);

    await item.getByRole('radio', { name: /Server version.*Fail/ }).click();
    await expect(page.getByTestId('combine-errors')).toHaveCount(0);
    await expect(item.getByLabel(/Comment/)).toHaveValue('Exit 3 blocked by pallets');
    await page.getByRole('button', { name: 'Save combined' }).click();
    await expectSynced(page);
    const server = await serverInspection(request, token, id);
    expect(server.version).toBe(3);
    expect(server.items[0]).toMatchObject({ result: 'fail', comment: 'Exit 3 blocked by pallets' });
  });
});
