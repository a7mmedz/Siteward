# Progress

Build plan: [PLAN.md](PLAN.md). Decisions: [docs/decisions.md](docs/decisions.md).

## Phases

- [x] Phase 1 — Repo scaffolding
- [x] Phase 2 — Backend core
- [x] Phase 3 — Sync endpoint
- [x] Phase 4 — Frontend foundation + local data
- [x] Phase 5 — Sync engine
- [x] Phase 6 — UI screens
- [x] Phase 7 — PWA / offline
- [x] Phase 8 — End-to-end tests
- [x] Phase 9 — Deployment prep
- [x] Phase 10 — Documentation
- [x] Phase 11 — Final check

**Status: complete (v1.0.0).** All phases done; lint, typecheck, 49 backend + 23 frontend tests and
11 end-to-end tests pass; production builds succeed. Only human-only tasks remain (below).

## Log

### Phase 1 — Repo scaffolding
- npm workspaces (`backend`, `frontend`, `e2e`), TypeScript configs, ESLint 9 flat config + Prettier, `.gitignore`, `.editorconfig`, `.gitattributes`.
- `docker-compose.yml` (Postgres 16 on port 5433, dev/test/e2e databases).
- `.env.example` for backend and frontend.
- Root scripts: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `db:up`, `db:migrate`, `db:seed`.
- Verified: `npm install && npm run build` and `npm run lint` succeed.

### Phase 2 — Backend core
- Prisma schema (User, Site, Inspection, ProcessedOp, ChecklistTemplate) + `init` migration + idempotent seed (3 sites, 1 inspector, 1 supervisor, 9-item template; passwords from env).
- Express 5 app: helmet, CORS allow-list from `CORS_ORIGIN`, JSON size limit, pino-http logs (auth header redacted), one error shape, Zod validation helpers.
- Auth: `POST /api/auth/login` (rate-limited), `GET /api/auth/me`, JWT middleware, role checks.
- `GET /api/sites`, `GET /api/checklist-template`, `GET /api/inspections?updatedSince`, `GET /api/inspections/:id`, `GET /api/health`.
- Tests: 21 Supertest tests (auth, access control, validation, incremental pull, CORS/headers) against an isolated `siteward_test` database. All pass.

### Phase 3 — Sync endpoint
- `POST /api/sync` (`backend/src/sync/service.ts`): batch ≤ 50, each op in its own transaction; `ProcessedOp` for idempotency; client-id idempotent creates; compare-and-set on `version` for conflicts; per-op `applied | duplicate | conflict | rejected`; unique-violation race handled.
- Business rules: submit requires all results + comments on failures; inspectors locked out of submitted inspections; soft delete.
- Demo tools: `FAIL_SYNC_RATE`, `POST /api/dev/fail-next-sync { count, mode: before|after }` (supervisor, `DEMO_TOOLS=true`).
- OpenAPI 3.1 spec in `docs/openapi.yaml`; Swagger UI at `/api/docs`, raw spec at `/api/openapi.yaml|json`.
- Tests: 28 new (create, update, batch order, submit, delete, duplicate opId → no extra row, concurrent replay, stale baseVersion → conflict, keep-mine path, permission/validation/lock rejections, malformed batch, demo tools, docs). Backend total 49, all pass.

### Phase 4 — Frontend foundation + local data
- Vite 8 + React 19 + TypeScript, React Router 7, Tailwind 4 with the §3 tokens as semantic roles (light + dark via `prefers-color-scheme`), Inter bundled.
- Dexie schema (`inspections`, `sites`, `outbox`, `meta`), API client with token handling and network/HTTP error kinds, client-side Zod validation mirroring the server.
- Repository layer (`frontend/src/data/repository.ts`): every write updates record + outbox in one transaction; coalescing rules (ADR-016); keep-mine / keep-server.
- Sync engine written (`frontend/src/sync/`); its tests land in Phase 5.
- Layout: header with logo, always-visible sync indicator + Sync now, sign-out (warns about unsynced changes), offline banner, mobile bottom nav. Login page with validation, re-auth mode, and a guard against silently discarding another user's unsynced work.
- Verified in Chromium against the local backend: sign in → initial pull → sites shown from IndexedDB → `Online · Synced`. Typecheck, build, lint pass.

### Phase 5 — Sync engine
- `frontend/src/sync/engine.ts`: push (≤ 50 ops, one op per record per round, parked records skipped), per-result handling (applied / duplicate → rebase follow-ups; conflict → park + serverCopy; rejected → error + drop), pull (sites, template, incremental inspections; never overwrites unsynced records; full pull removes stale synced rows), lock with one follow-up run, backoff 2s→60s, 401 → `Sign in to sync` with data kept, triggers (start, `online`, 30 s interval, debounced local change, Sync now), debug replay of the last batch.
- Tests: 23 Vitest tests with `fake-indexeddb` and a fake server behind a mocked `fetch` (pending → applied, coalescing, in-flight edit rebase, duplicate after lost response, replay, conflict + keep mine / keep server, rejection, network/500 backoff and recovery, 401, offline, lock, reload persistence, pull, header labels, client validation). A deliberate mutation of the rebase step is caught by two tests.

### Phase 6 — UI screens
- Sites (counts per site, one-tap New), site detail, inspections list (All / Drafts / Submitted / Needs attention tabs, sync badge per row, inspector name for supervisors), inspection editor (pass/fail/N/A radio groups, comments, notes, 500 ms autosave to IndexedDB, progress, grouped error summary + inline errors, submit, delete draft, read-only when submitted for inspectors, supervisor reopen), conflict screen (Your version vs Server version, differences highlighted, Keep mine / Keep server, guard when the server copy is locked), rejected-change notice with Discard, debug panel (`?debug=1`: engine state, outbox, last sync, Force retry last batch, supervisor failure buttons).
- Loading skeletons, empty states, offline banner; 44 px tap targets, labelled controls, visible focus, status never shown by colour alone, light + dark tokens.
- Verified in Chromium against the local stack (390 px and 1280 px): validation on submit, full fill + submit (server: submitted, v2), offline edit → supervisor edit → `1 conflict` → Keep mine (server v3 has the inspector note), debug panel. No console errors.

### Phase 7 — PWA / offline
- `vite-plugin-pwa`: precached app shell (27 entries incl. fonts and icons), SPA navigation fallback (API excluded), manifest in the blue theme with generated icons (192, 512, maskable, apple-touch, favicon), update prompt.
- Offline banner; cached user + token let the app open signed-in with no network.
- Verified on the production build (`vite preview`) with the backend process stopped and Chromium offline: app opens, lists saved inspections, creates and edits an inspection, survives two reloads; header shows `Offline · 1 pending`.

### Phase 8 — End-to-end tests
- Playwright suite in `e2e/` (11 tests) mirroring the required demonstration: online workflow + validation + access control (AC1, AC2, AC9); offline reload/edit/create/reload and reconnect with server = client (AC3–AC5); lost response → duplicate and debug replay (AC6); conflict → keep mine / keep server (AC7); 500s and unreachable server → queued → recovery (AC8); Swagger UI (AC10).
- Runs against the production build with a real service worker and an isolated backend/database. 11/11 passed on three consecutive runs.
- Evidence: 16 screenshots and `e2e-results.txt` in `docs/evidence/`.
- Note: Prisma refuses `migrate reset` from an AI agent without user consent; the harness uses non-destructive `migrate deploy` + seed instead (ADR-020).

### Phase 9 — Deployment prep
- `render.yaml` (API web service: build, migrate-on-start, health check, env vars with generated `JWT_SECRET`), `frontend/vercel.json` (workspace install, SPA rewrites, cache + security headers), build guard for a missing `VITE_API_URL` on Vercel.
- `docs/DEPLOY.md`: Neon → Render → Vercel step by step, env vars, seeding, verification, cold start, troubleshooting, rollback.
- Verified locally: `npm run build` succeeds; the compiled API starts with `NODE_ENV=production` (health, Swagger, HSTS/CSP headers OK); the frontend build embeds the configured API URL.

### Phase 10 — Documentation
- `README.md` with the seven required sections, the AC table (every criterion linked to tests and screenshots), setup with versions/inputs/expected results, demo access, verification results, limitations, libraries + licenses, and the AI assistance and contribution section.
- `docs/architecture.md` (system, components, data model, online/offline write, sync, conflict — Mermaid), `docs/sync-protocol.md` (outbox, push/pull, server rules, sequence diagrams, offline limits), `docs/demo-script.md` (live demo / recording script), `docs/decisions.md` (22 ADRs, incl. all those PLAN.md requires).
- Audit re-checked: `deepmerge-ts` (via the Prisma 6 CLI) was re-rated high during the build. An `overrides` pin broke the Prisma CLI and was reverted; the finding is documented in ADR-005 and the README, with the Prisma 7 upgrade as the fix.
- Backend `dev` script now pipes logs through `pino-pretty`.

### Phase 11 — Final check
- Fresh-clone simulation: cloned the repo into an empty directory, stopped the working database and started a brand-new one, then followed the README from zero: `npm install` → `.env` from the example → `db:up` → `db:migrate` → `db:seed` → `npm run dev` (health OK, sign-in OK, app served) → `lint` ✓ → `typecheck` ✓ (0 errors) → `npm test` ✓ (49 + 23) → `npm run test:e2e` ✓ (11/11) → `npm run build` ✓. No README changes were needed.
- Secret scan of tracked files and full git history: only `.env.example` templates are tracked; no tokens, keys or real connection strings; the local `.env` values appear nowhere in history. Test-only credentials (Vitest fixtures, the throwaway e2e database) are clearly labelled.
- Tagged `v1.0.0`.

## Needs human

Everything below needs accounts, real secrets or a person; the repository is ready for each step.

- [ ] **Deploy** following [docs/DEPLOY.md](docs/DEPLOY.md): create the Neon database, the Render service (Blueprint from `render.yaml`) and the Vercel project (root `frontend`); set `DATABASE_URL`, `CORS_ORIGIN`, `SEED_*_PASSWORD` on Render and `VITE_API_URL` on Vercel; run the seed once.
- [ ] **Paste the live URLs** (frontend, API, `/api/docs`) into the README: the banner at the top and section 4 "Demo and access". Then change AC10 in the README table from ⚠️ to ✅.
- [ ] **Share the demo passwords** with reviewers outside the repository.
- [ ] **Record the demo video** following [docs/demo-script.md](docs/demo-script.md) (warm up the Render API first: cold start).
- [ ] Optional hardening after deploy: add a Content-Security-Policy on Vercel with the final API host in `connect-src` (ADR-021); plan the Prisma 7 upgrade to clear the build-tool audit findings (ADR-005).
