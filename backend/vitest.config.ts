import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://siteward:siteward@localhost:5433/siteward_test?schema=public';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: 'test-only-secret-not-used-anywhere-else',
      LOG_LEVEL: 'silent',
    },
    globalSetup: './test/global-setup.ts',
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
