import { execSync } from 'node:child_process';

/** Applies migrations to the test database once before the suite runs. */
export default function setup() {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://siteward:siteward@localhost:5433/siteward_test?schema=public';
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
