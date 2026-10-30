# Progress

Build plan: [PLAN.md](PLAN.md). Decisions: [docs/decisions.md](docs/decisions.md).

## Phases

- [x] Phase 1 — Repo scaffolding
- [ ] Phase 2 — Backend core
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

## Needs human

_Nothing yet._
