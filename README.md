# Siteward

**Field inspections that work without signal.**

An offline-first progressive web app for building, warehouse and construction-site inspections.
Inspectors fill checklists on site with no connectivity; changes are stored on the device, synced
when the network returns, de-duplicated by the server, and conflicts with supervisors' edits are
resolved by a person, never silently.

> Live demo: **Frontend:** `https://<your-app>.vercel.app` · **API:** `https://<your-api>.onrender.com/api` ·
> **API docs:** `https://<your-api>.onrender.com/api/docs`
> _(URLs are filled in after deployment; see [Needs human](PROGRESS.md#needs-human).)_

---

## 1. Project and lane

**Lane:** Web.

**Problem.** Inspectors visit sites (buildings, warehouses, construction sites) with weak or no
connectivity. Paper checklists get lost and retyped; online-only apps fail on site.

**Users.**
- **Inspector** — creates and fills inspections on site, often offline. Sees only their own work.
- **Supervisor** — reviews all inspections and may edit them (the natural source of conflicts).

**Main workflow.** Sign in → pick a site → create an inspection → mark each checklist item
pass / fail / N/A with comments → autosave → submit. All of it works offline after the first online
visit, and syncs later.

## 2. Requirements and status

All criteria are covered by automated tests. ✅ = implemented and verified locally by the linked
tests; hosting (AC10) is prepared and verified with production builds, and goes live when the
deployment in [docs/DEPLOY.md](docs/DEPLOY.md) is done.

| ID | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| AC1 | User can log in; inspectors see only their own inspections, supervisors see all. | ✅ | [backend/test/access.test.ts](backend/test/access.test.ts), [backend/test/auth.test.ts](backend/test/auth.test.ts), [e2e/tests/01-online.spec.ts](e2e/tests/01-online.spec.ts) · [screenshot](docs/evidence/ac1-supervisor-list.png) |
| AC2 | Online: create, edit, and submit an inspection; data is stored on the server. | ✅ | [e2e/tests/01-online.spec.ts](e2e/tests/01-online.spec.ts), [backend/test/sync.test.ts](backend/test/sync.test.ts) · [filled](docs/evidence/ac2-editor-filled.png), [submitted](docs/evidence/ac2-submitted-list.png) |
| AC3 | After one online visit, the app opens with no network and shows previously saved data. | ✅ | [e2e/tests/02-offline.spec.ts](e2e/tests/02-offline.spec.ts) (offline reload + offline deep link, real service worker) · [screenshot](docs/evidence/ac3-offline-reload.png) |
| AC4 | Offline: user can create and edit inspections; changes survive page reloads. | ✅ | [e2e/tests/02-offline.spec.ts](e2e/tests/02-offline.spec.ts), [frontend/src/sync/engine.test.ts](frontend/src/sync/engine.test.ts) ("persistence across reloads") · [screenshot](docs/evidence/ac4-offline-edits-after-reload.png) |
| AC5 | On reconnect, pending changes sync automatically; server data matches the client. | ✅ | [e2e/tests/02-offline.spec.ts](e2e/tests/02-offline.spec.ts) (compares IndexedDB and API field by field) · [screenshot](docs/evidence/ac5-back-online-synced.png) |
| AC6 | Retrying the same sync request creates no duplicate records (idempotency). | ✅ | [backend/test/sync.test.ts](backend/test/sync.test.ts) (replay, concurrent replay), [frontend/src/sync/engine.test.ts](frontend/src/sync/engine.test.ts), [e2e/tests/03-idempotency.spec.ts](e2e/tests/03-idempotency.spec.ts) · [lost response](docs/evidence/ac6-lost-response.png), [replay → duplicate](docs/evidence/ac6-replay-duplicate.png) |
| AC7 | Conflicting edits are detected and the user can resolve them (keep mine / keep server). | ✅ | [backend/test/sync.test.ts](backend/test/sync.test.ts), [frontend/src/sync/engine.test.ts](frontend/src/sync/engine.test.ts), [e2e/tests/04-conflict.spec.ts](e2e/tests/04-conflict.spec.ts) · [conflict screen](docs/evidence/ac7-conflict-screen.png), [resolved](docs/evidence/ac7-keep-mine-synced.png) |
| AC8 | Failed sync (server down / 500) keeps changes queued, shows status, and recovers on retry. | ✅ | [frontend/src/sync/engine.test.ts](frontend/src/sync/engine.test.ts) (backoff), [backend/test/sync.test.ts](backend/test/sync.test.ts) (demo tools), [e2e/tests/05-failure.spec.ts](e2e/tests/05-failure.spec.ts) (500s and unreachable server) · [queued](docs/evidence/ac8-sync-failed-queued.png), [recovered](docs/evidence/ac8-recovered.png) |
| AC9 | Invalid input is rejected with clear messages on both client and server. | ✅ | [backend/test/sync.test.ts](backend/test/sync.test.ts), [backend/test/auth.test.ts](backend/test/auth.test.ts), [frontend/src/data/validation.test.ts](frontend/src/data/validation.test.ts), [e2e/tests/01-online.spec.ts](e2e/tests/01-online.spec.ts) · [login](docs/evidence/ac9-login-errors.png), [submit](docs/evidence/ac9-submit-validation.png) |
| AC10 | Frontend and backend are hosted separately over HTTPS; API docs are available. | ⚠️ prepared, deploy pending | [render.yaml](render.yaml), [frontend/vercel.json](frontend/vercel.json), [docs/DEPLOY.md](docs/DEPLOY.md), [docs/openapi.yaml](docs/openapi.yaml), [e2e/tests/06-api-docs.spec.ts](e2e/tests/06-api-docs.spec.ts) · [Swagger UI](docs/evidence/ac10-api-docs.png) |

Latest end-to-end run: [docs/evidence/e2e-results.txt](docs/evidence/e2e-results.txt).

## 3. Setup and run

### Requirements

| Tool | Version | Used for |
|---|---|---|
| Node.js | ≥ 20.19 (tested on 24.22) | everything |
| npm | ≥ 10 (tested on 11.19) | workspaces |
| Docker + Docker Compose | any recent | local PostgreSQL 16 |

npm 11 asks before running dependency install scripts; the repository's `allowScripts` (root
`package.json`) already approves the ones needed (esbuild, Prisma engines).

### Local setup

```bash
git clone <repo-url> siteward && cd siteward
npm install                         # all workspaces; also generates the Prisma client

cp backend/.env.example backend/.env
# Edit backend/.env: set JWT_SECRET (long random string) and the two SEED_*_PASSWORD values.
# Optional: DEMO_TOOLS=true to enable the failure-demo endpoint.

npm run db:up                       # PostgreSQL on localhost:5433 (dev, test and e2e databases)
npm run db:migrate                  # apply migrations to the dev database
npm run db:seed                     # 3 sites, inspector + supervisor, checklist template
npm run dev                         # API on :4000, web app on :5173
```

Open <http://localhost:5173> and sign in as `inspector@siteward.test` or `supervisor@siteward.test`
with the passwords you put in `backend/.env`. The frontend talks to `http://localhost:4000/api` by
default; override with `VITE_API_URL` in `frontend/.env.local` (see `frontend/.env.example`).

**Inputs:** the env files above (no other configuration). **Expected results:** `npm run db:seed`
prints `Seeded 2 users, 3 sites, 1 checklist template.`; <http://localhost:4000/api/health> returns
`{"status":"ok","db":"up",…}`; after signing in, the header shows `Online · Synced` and three sites.

**Trying offline locally.** The Vite dev server does not run the service worker. Build and preview
the production frontend instead (port 4173 is already in the default `CORS_ORIGIN`):

```bash
npm run build && npm run preview -w frontend   # http://localhost:4173
```

Sign in, wait for `Online · Synced`, then switch Chrome DevTools → Network to **Offline** and reload.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + web app (Vite) |
| `npm run build` | Compile the API and build the PWA |
| `npm test` | Backend (Vitest + Supertest, real Postgres) and frontend (Vitest + fake-indexeddb) unit/integration tests |
| `npm run test:e2e` | Playwright end-to-end suite (starts its own API on :4100 and production build on :4174) |
| `npm run lint` · `npm run typecheck` | ESLint + Prettier · TypeScript in all workspaces |
| `npm run db:up` · `db:migrate` · `db:seed` | Local database |

## 4. Demo and access

- **Frontend:** `https://<your-app>.vercel.app` _(placeholder)_
- **API:** `https://<your-api>.onrender.com/api` · **API docs:** `/api/docs` _(placeholder)_
- **Demo accounts:** `inspector@siteward.test` (inspector) and `supervisor@siteward.test`
  (supervisor). Passwords are **not** in the repository; they are set as `SEED_*_PASSWORD` on the
  server and shared with reviewers separately.
- **Cold start:** the API runs on Render's free tier, which sleeps after ~15 minutes idle. The first
  request after that takes ~30–60 s. The app stays usable meanwhile (it is offline-first) and syncs
  as soon as the API answers.
- **Walkthrough** (full script with talking points: [docs/demo-script.md](docs/demo-script.md)):
  1. Sign in as each role; the supervisor sees everyone's inspections (AC1).
  2. Create, fill and submit an inspection online; see it on the server (AC2, AC9).
  3. Go offline, reload, edit, create, reload again (AC3, AC4).
  4. Reconnect: automatic sync; the server matches the device (AC5).
  5. "Lose next response" from the debug panel (`?debug=1`): retry returns `duplicate`, no extra row (AC6).
  6. Supervisor edits while the inspector is offline → conflict → Keep mine / Keep server (AC7).
  7. "Fail next sync": changes stay queued, `Sync failed · Retry`, recovery (AC8).
  8. Show both HTTPS URLs and Swagger UI (AC10).

## 5. Architecture and decisions

- [docs/architecture.md](docs/architecture.md) — system diagram, components, data model, data flows
  for online write, offline write, sync and conflict.
- [docs/sync-protocol.md](docs/sync-protocol.md) — the outbox, push/pull, server rules, idempotency,
  conflict handling, with sequence diagrams.
- [docs/decisions.md](docs/decisions.md) — 22 short ADRs (IndexedDB vs localStorage, client-generated
  ids, batch sync endpoint, idempotency via `opId`, version conflicts with user resolution, monorepo,
  hosting, and more).
- [docs/openapi.yaml](docs/openapi.yaml) — API contract (served as Swagger UI at `/api/docs`).
- [docs/DEPLOY.md](docs/DEPLOY.md) — deployment steps for Neon, Render and Vercel.

**Stack:** React 19 + Vite 8 + TypeScript, React Router 7, Tailwind CSS 4, Dexie (IndexedDB),
vite-plugin-pwa (Workbox), Zod · Node + Express 5 + TypeScript, Prisma 6, PostgreSQL 16, JWT,
bcrypt, helmet, pino, swagger-ui-express · Vitest, Supertest, fake-indexeddb, Playwright.

```
backend/   Express API, Prisma schema + migrations + seed, Vitest/Supertest tests
frontend/  React PWA: pages, components, data (repository, validation), sync engine, Dexie db
e2e/       Playwright scenarios (one file per demo step)
docs/      Architecture, sync protocol, ADRs, OpenAPI, deploy guide, demo script, evidence
```

## 6. Verification and limitations

### How to verify

```bash
npm run db:up
npm run lint && npm run typecheck
npm test            # backend: 49 tests · frontend: 23 tests
npm run test:e2e    # 11 Playwright scenarios (Chromium, Pixel 7 profile)
npm run build
```

Latest results (local, Windows 11, Node 24): lint and typecheck clean; **49/49** backend,
**23/23** frontend, **11/11** end-to-end (stable over three consecutive runs); production builds
succeed. The backend tests run against a real PostgreSQL database (`siteward_test`, truncated per
test); the end-to-end tests run against the production build with a real service worker.

### Recovery logic (summary)

- Every local change is written to IndexedDB together with an outbox operation in one transaction.
- Sync pushes ops in order; each has an `opId` the server remembers, so retries never duplicate.
- Network errors and 5xx keep ops queued with exponential backoff (2 s → 60 s) and a visible
  `Sync failed · Retry`; a 401 keeps data and asks the user to sign in again.
- A stale `baseVersion` is a conflict: nothing is overwritten until the user chooses.
- A rejected change (validation, permission, lock) is shown on the record with the server's message
  and can be fixed or discarded.

### Limitations

- The first visit must be online; signing in needs the network.
- A token that expires while offline needs a new sign-in before syncing (local data is kept).
- Storage is limited by the browser's quota; clearing site data or signing out loses unsynced changes
  (sign-out warns first).
- No real-time push: other users' changes appear on the next pull (≤ 30 s, or Sync now).
- Conflicts are resolved per whole inspection, not per field.
- The JWT is stored in localStorage (readable by scripts on the origin; see ADR-015).
- The checklist template is fixed per inspection at creation; there is no template editor.
- Free hosting: the API sleeps when idle (cold start), and demo failure tools are enabled in the demo
  deployment (`DEMO_TOOLS=true`, supervisor-only).
- `npm audit` reports 3 high and 4 low findings, all in build-time tooling (Prisma 6 CLI config
  loader, Workbox build), none in shipped or request-handling code. Upgrading to Prisma 7 is the
  planned fix ([ADR-005](docs/decisions.md)).

## 7. Credits and contribution

### Libraries and licenses

| Library | License | Library | License |
|---|---|---|---|
| React, React DOM | MIT | Express | MIT |
| React Router | MIT | Prisma, @prisma/client | Apache-2.0 |
| Vite, @vitejs/plugin-react | MIT | Zod | MIT |
| vite-plugin-pwa, workbox-window, @vite-pwa/assets-generator | MIT | jsonwebtoken | MIT |
| Tailwind CSS, @tailwindcss/vite | MIT | bcryptjs | BSD-3-Clause |
| Dexie, dexie-react-hooks | Apache-2.0 | helmet, cors, express-rate-limit | MIT |
| Inter (@fontsource-variable/inter) | OFL-1.1 | pino, pino-http, pino-pretty | MIT |
| TypeScript | Apache-2.0 | swagger-ui-express | MIT |
| Vitest | MIT | yaml | ISC |
| Playwright | Apache-2.0 | Supertest | MIT |
| fake-indexeddb | Apache-2.0 | tsx, concurrently | MIT |
| ESLint, typescript-eslint, eslint-plugin-react-hooks, Prettier | MIT | PostgreSQL (Docker image) | PostgreSQL License |

Icons are original inline SVGs; the logo and PWA icons were drawn for this project.

### AI assistance and contribution

This project was built with substantial AI assistance, and this section describes the split as it
happened.

**Candidate.** Chose the Web lane, the field-inspection idea and the target users (inspectors and
supervisors). Defined the requirements and the ten acceptance criteria, the stack, the offline/sync
approach (IndexedDB outbox, client-generated ids, `opId` idempotency, version-based conflicts with
user resolution), the design system, and the eleven-phase build plan in [PLAN.md](PLAN.md). Directed
and reviewed the AI's work, deployed the frontend and backend, ran the demo, and verified the results.

**AI (Claude Code, by Anthropic).** Working from PLAN.md under the candidate's direction, generated
most of the implementation code (backend, frontend, sync engine, service worker setup), the unit,
integration and end-to-end tests, the deployment configuration, and the documentation, including this
README. It ran the tests and builds at each phase, fixed the failures it found, and recorded the
choices it made where the plan left room (for example the checklist-template endpoint, outbox
coalescing and rebasing, and a non-destructive end-to-end database setup) as ADRs.

**Record of the work.** [PLAN.md](PLAN.md) (the plan as given), [docs/decisions.md](docs/decisions.md)
(every non-trivial choice and its tradeoff), [PROGRESS.md](PROGRESS.md) (what was done in each phase),
and the commit history (one or more commits per phase).
