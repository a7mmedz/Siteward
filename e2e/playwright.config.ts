import { defineConfig, devices } from '@playwright/test';

/**
 * Runs an isolated stack: backend on :4100 against the `siteward_e2e` database (reset + seeded in
 * global setup, demo tools on) and the production frontend build (real service worker) on :4174.
 * Requires the Docker Compose Postgres (`npm run db:up`).
 */
export const API_PORT = 4100;
export const WEB_PORT = 4174;
export const API_URL = `http://localhost:${API_PORT}/api`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

export const E2E_ENV = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL:
    process.env.E2E_DATABASE_URL ??
    'postgresql://siteward:siteward@localhost:5433/siteward_e2e?schema=public',
  JWT_SECRET: 'e2e-only-secret-not-used-anywhere-else',
  CORS_ORIGIN: WEB_URL,
  LOG_LEVEL: 'warn',
  LOGIN_RATE_LIMIT: '1000',
  DEMO_TOOLS: 'true',
  FAIL_SYNC_RATE: '0',
  // Throwaway credentials for the throwaway e2e database only.
  SEED_INSPECTOR_PASSWORD: 'e2e-inspector-password',
  SEED_SUPERVISOR_PASSWORD: 'e2e-supervisor-password',
};

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // One shared database and server-side demo switches: run serially.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  outputDir: 'test-results',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'npx tsx ../backend/src/index.ts',
      url: `${API_URL}/health`,
      env: E2E_ENV,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run build -w frontend && npm run preview -w frontend -- --port ${WEB_PORT} --strictPort`,
      cwd: '..',
      url: WEB_URL,
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
