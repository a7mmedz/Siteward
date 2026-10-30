import { expect, test } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { evidence } from './helpers';

test('Swagger UI renders the API docs (AC10)', async ({ page }) => {
  await page.goto(`${API_URL}/docs/`);
  await expect(page.getByRole('heading', { name: /Siteward API/ })).toBeVisible();
  await expect(page.getByText('/sync', { exact: true }).first()).toBeVisible();
  await evidence(page, 'ac10-api-docs');
});
