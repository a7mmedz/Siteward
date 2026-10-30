import { expect, test } from '@playwright/test';
import {
  apiToken,
  evidence,
  expectSynced,
  login,
  newInspection,
  serverInspection,
  serverInspections,
  setResult,
  waitSaved,
  RUN,
} from './helpers';

test.describe('Scenario 1 — online workflow (AC1, AC2, AC9)', () => {
  test('rejects bad sign-in input with clear messages (AC9)', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('Password is required')).toBeVisible();

    await page.getByLabel('Email').fill('inspector@siteward.test');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect');
    await evidence(page, 'ac9-login-errors');
  });

  test('inspector creates, edits and submits; the server stores it (AC2, AC9)', async ({
    page,
    request,
  }) => {
    await login(page, 'inspector');
    await evidence(page, 'ac2-sites');
    const id = await newInspection(page, 'Northgate Office Tower');

    await page.getByLabel('Title').fill(`Northgate quarterly safety walk ${RUN}`);
    await page.getByLabel('Notes').fill('Met the facilities manager at reception.');
    await waitSaved(page);
    await expectSynced(page);
    const token = await apiToken(request, 'inspector');
    expect(await serverInspection(request, token, id)).toMatchObject({
      title: `Northgate quarterly safety walk ${RUN}`,
      status: 'draft',
    });

    // Client-side validation blocks an incomplete submit (AC9).
    await page.getByRole('button', { name: 'Submit inspection' }).click();
    const summary = page.getByTestId('error-summary');
    await expect(summary).toContainText('9 items need a result');
    await evidence(page, 'ac9-submit-validation');

    const items = page.getByTestId('checklist-item');
    const count = await items.count();
    for (let i = 0; i < count; i++) await setResult(page, i, 'Pass');
    await setResult(page, 1, 'Fail');
    await page.getByRole('button', { name: 'Submit inspection' }).click();
    await expect(summary).toContainText('1 failed item needs a comment');
    await items
      .nth(1)
      .getByLabel(/Comment/)
      .fill('Extinguisher on level 3 expired in May.');
    await setResult(page, 8, 'N/A');
    await evidence(page, 'ac2-editor-filled');
    await page.getByRole('button', { name: 'Submit inspection' }).click();

    await page.waitForURL('**/inspections');
    await expectSynced(page);
    const row = page
      .getByTestId('inspection-row')
      .filter({ hasText: `Northgate quarterly safety walk ${RUN}` });
    await expect(row).toContainText('Submitted');
    await expect(row).toContainText('Synced');
    await evidence(page, 'ac2-submitted-list');

    const server = await serverInspection(request, token, id);
    expect(server.status).toBe('submitted');
    expect(server.items[1]).toMatchObject({
      result: 'fail',
      comment: 'Extinguisher on level 3 expired in May.',
    });
    expect(server.items[8]!.result).toBe('na');
    expect(server.items.every((i) => i.result !== null)).toBe(true);

    // Submitted inspections are read-only for the inspector.
    await row.click();
    await expect(page.getByText('This inspection is submitted and locked.')).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveAttribute('readonly', '');
  });

  test('inspectors see only their own inspections; supervisors see all (AC1)', async ({
    page,
    request,
  }) => {
    const inspectorToken = await apiToken(request, 'inspector');
    const supervisorToken = await apiToken(request, 'supervisor');
    const mine = await serverInspections(request, inspectorToken);
    const all = await serverInspections(request, supervisorToken);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((i) => i.inspectorName === 'Maya Inspector')).toBe(true);

    // The supervisor creates one of their own; the inspector must not see it.
    await login(page, 'supervisor');
    const supervisorsOwn = await newInspection(page, 'Harbor Logistics Warehouse');
    await page.getByLabel('Title').fill(`Supervisor spot check ${RUN}`);
    await waitSaved(page);
    await expectSynced(page);
    const mineAfter = await serverInspections(request, inspectorToken);
    expect(mineAfter.map((i) => i.id)).not.toContain(supervisorsOwn);
    const allAfter = await serverInspections(request, supervisorToken);
    expect(allAfter.length).toBe(all.length + 1);

    // The supervisor's list shows inspector names.
    await page.goto('/inspections');
    await expect(
      page
        .getByTestId('inspection-row')
        .filter({ hasText: `Northgate quarterly safety walk ${RUN}` }),
    ).toContainText('Maya Inspector');
    await evidence(page, 'ac1-supervisor-list');
  });
});
