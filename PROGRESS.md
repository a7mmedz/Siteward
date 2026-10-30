# Progress

Build plan: [PLAN.md](PLAN.md). Decisions: [docs/decisions.md](docs/decisions.md).

## Phases

- [x] Phase 1 — Repo scaffolding
- [x] Phase 2 — Backend core
- [ ] Phase 3 — Sync endpoint
- [ ] Phase 4 — Frontend foundation + local data
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

## Needs human

_Nothing yet._
