# Progress

Build plan: [PLAN.md](PLAN.md). Decisions: [docs/decisions.md](docs/decisions.md).

## Phases

- [x] Phase 1 — Repo scaffolding
- [x] Phase 2 — Backend core
- [x] Phase 3 — Sync endpoint
- [x] Phase 4 — Frontend foundation + local data
- [ ] Phase 5 — Sync engine
- [ ] Phase 6 — UI screens
- [ ] Phase 7 — PWA / offline
- [ ] Phase 8 — End-to-end tests
- [ ] Phase 9 — Deployment prep
- [ ] Phase 10 — Documentation
- [ ] Phase 11 — Final check

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

## Needs human

_Nothing yet._
