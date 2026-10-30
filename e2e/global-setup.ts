import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { E2E_ENV } from './playwright.config';

/**
 * Prepares the e2e database without destroying anything: apply pending migrations and run the
 * idempotent seed. Tests use unique titles per run and relative counts, so rows left by earlier
 * runs do not matter.
 */
export default function globalSetup() {
  const backend = fileURLToPath(new URL('../backend', import.meta.url));
  const opts = { cwd: backend, env: { ...process.env, ...E2E_ENV }, stdio: 'inherit' as const };
  execSync('npx prisma migrate deploy', opts);
  execSync('npx tsx prisma/seed.ts', opts);
}
