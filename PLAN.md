# Siteward — Build Plan (InvoSpark Web Lane)

> This file is the single source of truth for building the project.
> Execute every phase in order. Do not stop to ask questions. When something is unclear,
> pick the most reasonable, standard option, record it in `docs/decisions.md`, and continue.

---

## 0. Operating rules for the agent

1. **Never stop for confirmation.** Make the best engineering choice and keep going.
2. **Record decisions.** Every non-trivial choice goes in `docs/decisions.md` (short ADR: context, decision, alternative considered, tradeoff).
3. **Track progress.** Keep `PROGRESS.md` updated: phase checklist, what was done, anything blocked.
4. **If blocked by something only the human can do** (creating hosting accounts, real secrets, DNS), prepare everything up to that point (config files, env templates, exact steps in `docs/DEPLOY.md`), note it in `PROGRESS.md` under "Needs human", and **continue with the next phase**.
5. **Commit after each phase** with a clear conventional message (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Small, readable commits inside a phase are welcome.
6. **No secrets in Git.** Use `.env.example` files with placeholders. `.env` is gitignored.
7. **Run the tests and the build at the end of every phase.** Fix failures before moving on.
8. **Use available skills.** Use the `frontend-design` skill (if available) for the UI phase. Use a browser/webapp testing skill (e.g. `webapp-testing`, if available) or Playwright for end-to-end tests. Use subagents only for clearly independent work.
9. **Keep it simple.** Two-day scope. Prefer boring, well-known libraries. No feature beyond this plan until all phases pass.

---

## 1. Product

**Name:** Siteward
**Tagline:** Field inspections that work without signal.

**Problem:** Inspectors visit sites (buildings, warehouses, construction sites) with weak or no connectivity. Paper checklists get lost and retyped; online-only apps fail on site.

**Users:**
- **Inspector** — creates and fills inspections on site, often offline.
- **Supervisor** — reviews inspections and may edit them (this is the natural source of conflicts).

**Main workflow:**
Log in → pick a site → create an inspection → fill checklist items (pass / fail / N/A + comment) → save → submit. All of it must work offline after the first online visit, and sync later.

### Acceptance criteria (link each to evidence in README)

| ID | Criterion |
|----|-----------|
| AC1 | User can log in; inspectors see only their own inspections, supervisors see all. |
| AC2 | Online: create, edit, and submit an inspection; data is stored on the server. |
| AC3 | After one online visit, the app opens with no network (airplane mode) and shows previously saved data. |
| AC4 | Offline: user can create and edit inspections; changes survive page reloads. |
| AC5 | On reconnect, pending changes sync automatically; server data matches the client. |
| AC6 | Retrying the same sync request creates no duplicate records (idempotency). |
| AC7 | Conflicting edits are detected and the user can resolve them (keep mine / keep server). |
| AC8 | Failed sync (server down / 500) keeps changes queued, shows status, and recovers on retry. |
| AC9 | Invalid input is rejected with clear messages on both client and server. |
| AC10 | Frontend and backend are hosted separately over HTTPS; API docs are available. |

---

## 2. Stack

- **Monorepo:** npm workspaces — `frontend/`, `backend/`, `docs/`.
- **Frontend:** React + Vite + TypeScript, React Router, `vite-plugin-pwa` (Workbox) for the service worker, **Dexie** (IndexedDB), Zod for validation, Tailwind CSS.
- **Backend:** Node 20+ + Express + TypeScript, Zod, Prisma, PostgreSQL, JWT auth (bcrypt password hashes), `swagger-ui-express` serving an OpenAPI spec, `helmet`, `cors`, `pino` logging.
- **Database:** PostgreSQL (local via Docker Compose; hosted on Neon or Render Postgres).
- **Tests:** Vitest + Supertest (backend), Vitest + `fake-indexeddb` (sync engine), Playwright (end-to-end, including offline via `context.setOffline(true)`).
- **Hosting:** Frontend on Vercel, backend on Render, DB on Neon/Render. Free tiers.

---

## 3. Design system

**Theme: degrees of blue.** Clean, professional, high contrast, mobile-first (inspectors use phones).

| Token | Hex | Use |
|-------|-----|-----|
| `navy-900` | `#0B1F3A` | Headers, primary text on light |
| `blue-700` | `#1E4FA3` | Primary buttons, links, active nav |
| `blue-500` | `#3B82F6` | Focus rings, highlights, progress |
| `blue-200` | `#BFD7F6` | Borders, dividers |
| `blue-50`  | `#EEF4FC` | App background, cards hover |
| `white`    | `#FFFFFF` | Cards, inputs |
| `slate-600`| `#475569` | Secondary text |

**Status colors (sync + results):**
| Meaning | Hex |
|---------|-----|
| Synced / Pass | `#16A34A` (green) |
| Pending / N/A | `#D97706` (amber) |
| Conflict / Fail | `#DC2626` (red) |
| Offline banner | `#0B1F3A` background, white text |

- Font: Inter (Google Fonts), fallback system-ui.
- Always-visible **connection + sync indicator** in the header: `Online · Synced`, `Offline · 3 pending`, `Syncing…`, `1 conflict`, `Sync failed · Retry`.
- Logo: simple wordmark "Siteward" with a small shield/check icon in `blue-700`.
- Support dark mode via the same tokens (navy background, blue accents).

---

## 4. Data model (Prisma)

```
User        id (uuid), email (unique), name, passwordHash, role ('inspector'|'supervisor'), createdAt
Site        id (uuid), name, address, createdAt
Inspection  id (uuid, CLIENT-generated), siteId, inspectorId, title, notes,
            status ('draft'|'submitted'),
            items Json   -- [{ id, label, result: 'pass'|'fail'|'na'|null, comment }]
            version Int  -- starts at 1, +1 on every server write
            createdAt, updatedAt, deletedAt (nullable, soft delete)
ProcessedOp opId (uuid, PK), userId, result Json, createdAt
```

- IDs for inspections are generated on the client (`crypto.randomUUID()`), so offline creates have a stable ID and creates are naturally idempotent.
- Seed: 3 sites, 1 inspector, 1 supervisor, a default checklist template (8–10 items). Demo passwords come from env vars `SEED_INSPECTOR_PASSWORD` / `SEED_SUPERVISOR_PASSWORD` (placeholders in `.env.example`).

---

## 5. API

Base path `/api`. JSON. Errors use one shape: `{ error: { code, message, details? } }`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/login` | email + password → `{ token, user }` |
| GET | `/auth/me` | current user |
| GET | `/sites` | list sites |
| GET | `/inspections?updatedSince=ISO` | list visible inspections (incremental pull) |
| GET | `/inspections/:id` | one inspection |
| POST | `/sync` | push a batch of operations (see §6) |
| GET | `/health` | health check |
| GET | `/docs` | Swagger UI (OpenAPI spec in `docs/openapi.yaml`) |

Access control: inspectors read/write only their own inspections; supervisors read/write all. Enforced on the server.

---

## 6. Offline & sync design

### Storage on the client
| Store | What | Why |
|-------|------|-----|
| Cache Storage (service worker / Workbox precache) | App shell: HTML, JS, CSS, fonts, icons | App opens offline |
| IndexedDB via Dexie: `inspections`, `sites`, `meta` | Local copy of data + `lastPulledAt` + cached user | Read/write offline, survives reloads |
| IndexedDB `outbox` | Pending operations | Queue to replay on reconnect |
| localStorage | JWT token + small UI prefs only | Simple; documented as a limitation |

**Rule: the UI only reads/writes IndexedDB.** It never calls the API directly for data. The sync engine is the only thing that talks to the server.

### Outbox operation
```ts
{ opId: uuid, type: 'create'|'update'|'delete', entity: 'inspection',
  entityId: uuid, baseVersion: number|null, payload: {...}, createdAt, attempts, lastError }
```
Each local save writes the record (with `syncState: 'pending'`) **and** appends an outbox op, in one Dexie transaction. Multiple edits to the same record may be coalesced into the latest op (document this).

### Sync engine (`frontend/src/sync/`)
Triggers: app start, `online` event, every 30s while online, and a "Sync now" button. Only one sync at a time (lock).
1. **Push:** send outbox ops in order to `POST /sync` (batch, max 50).
2. Per-op result handling:
   - `applied` → remove op, update local record with server copy (new `version`), `syncState: 'synced'`.
   - `duplicate` → same as applied (server already processed this `opId`).
   - `conflict` → keep op aside, mark record `syncState: 'conflict'`, store `serverCopy` on the record.
   - `rejected` (validation/permission) → mark record `syncState: 'error'` with message; remove from active queue.
3. Network error / 5xx → keep ops, increment `attempts`, exponential backoff (2s, 4s, 8s… max 60s), show "Sync failed · Retry".
4. 401 → keep ops, ask user to log in again; never discard queued data.
5. **Pull:** `GET /inspections?updatedSince=lastPulledAt` and upsert into IndexedDB, skipping records that have pending local ops.

### Server `/sync` rules (one DB transaction per op)
1. If `opId` exists in `ProcessedOp` → return stored result as `duplicate`. **(AC6)**
2. Check permissions and validate payload with Zod → else `rejected`.
3. `create`: if the ID already exists, treat as duplicate-safe; else insert with `version = 1`.
4. `update`/`delete`: if `baseVersion !== current.version` → `conflict` with `serverCopy`. **(AC7)**
   Else apply, `version + 1`.
5. Store `ProcessedOp` with the result in the same transaction.

### Conflict resolution UI
Conflict screen shows "Your version" vs "Server version" side by side (changed fields highlighted):
- **Keep mine** → new op with `baseVersion = serverCopy.version`.
- **Keep server** → overwrite local with server copy, drop the op.
Default policy documented in `docs/decisions.md`: no silent overwrite; user decides.

### Dev/demo helpers
- Backend env `FAIL_SYNC_RATE` (0–1) and a supervisor-only `POST /api/dev/fail-next-sync` (enabled only when `DEMO_TOOLS=true`) to demonstrate failed sync and recovery (AC8).
- Frontend debug panel (hidden behind `?debug=1`): outbox contents, last sync result, "Force retry last batch" button to demo idempotency (AC6).

### Documented limits of offline behavior
First visit must be online; login requires network; token expiry while offline needs re-login before sync; storage bound by browser quota; clearing site data loses unsynced changes; no real-time push.

---

## 7. Phases

### Phase 1 — Repo scaffolding
- npm workspaces, TypeScript configs, ESLint + Prettier, `.gitignore`, `.editorconfig`.
- `docker-compose.yml` with Postgres for local dev.
- `.env.example` for frontend and backend.
- Root scripts: `dev`, `build`, `test`, `lint`, `db:migrate`, `db:seed`.
- Create `PROGRESS.md`, `docs/decisions.md`.
- **Exit:** `npm install && npm run build` succeed. Commit.

### Phase 2 — Backend core
- Prisma schema + migration + seed (§4).
- Express app: helmet, cors (allowed origin from env), JSON limit, pino logs, error middleware, Zod validation.
- Auth (login, me), JWT middleware, role-based access.
- `GET /sites`, `GET /inspections`, `GET /inspections/:id`, `/health`.
- **Exit:** Supertest tests for auth, access control, validation pass. Commit.

### Phase 3 — Sync endpoint
- `POST /sync` exactly as §6 server rules, transactional, with `ProcessedOp`.
- Demo failure tools behind env flags.
- OpenAPI spec `docs/openapi.yaml` + Swagger UI at `/api/docs`.
- **Exit:** tests for: create, update, duplicate opId returns `duplicate` and no extra row, stale `baseVersion` returns `conflict`, permission rejection, validation rejection. Commit.

### Phase 4 — Frontend foundation + local data
- Vite React TS app, Tailwind with the §3 tokens, router, layout, header with sync indicator.
- Dexie schema (§6), API client with token handling, login page.
- Repository layer: all UI reads/writes go through Dexie + outbox.
- **Exit:** builds, can log in against local backend. Commit.

### Phase 5 — Sync engine
- Implement `frontend/src/sync/` per §6 (push, pull, lock, backoff, triggers, 401 handling).
- Unit tests with `fake-indexeddb` and mocked fetch: pending → applied, duplicate, conflict, network failure → retry, reload persistence.
- **Exit:** tests pass. Commit.

### Phase 6 — UI screens (use `frontend-design` skill if available)
- Sites list, inspections list (filter by status, sync badge per row), inspection editor (checklist with pass/fail/N/A buttons, comments, notes, autosave), submit, conflict resolution screen, debug panel.
- Loading, empty, error, and offline states. Mobile-first, accessible (labels, focus, contrast).
- **Exit:** full workflow works locally online. Commit.

### Phase 7 — PWA / offline
- `vite-plugin-pwa`: precache app shell, SPA navigation fallback, manifest (name, icons in blue theme), update prompt.
- Offline banner; cached user lets app open offline.
- **Exit:** with backend stopped and browser offline, the app opens, shows data, allows edits, survives reload. Commit.

### Phase 8 — End-to-end tests (Playwright / testing skill)
Scenarios mirroring the required demonstration:
1. Online workflow complete (AC2).
2. Go offline → reload → edit → reload → data still there (AC3, AC4).
3. Back online → synced → server data equals client (AC5).
4. Replay the same sync batch → no duplicates (AC6).
5. Supervisor edits same inspection while inspector offline → conflict → resolve (AC7).
6. Server failure → queued → recovery (AC8).
- Save screenshots/traces to `docs/evidence/`.
- **Exit:** all e2e pass locally. Commit.

### Phase 9 — Deployment prep
- `render.yaml` (backend web service + build/start commands + migrate on deploy), `vercel.json` (SPA rewrites), production env docs, CORS config, HTTPS-only assumptions.
- `docs/DEPLOY.md`: exact step-by-step for the human: create Neon/Render DB, Render service, Vercel project (root dir `frontend`), env vars to set, how to seed, how to verify.
- Note the Render free-tier cold start in README.
- **Exit:** production builds succeed locally. Mark "Deploy to Vercel/Render" under "Needs human" in `PROGRESS.md`. Commit.

### Phase 10 — Documentation
- `README.md` with these sections (required by the brief):
  1. Project and lane (Web lane; problem, user, main workflow)
  2. Requirements and status (AC table with ✅/⚠️ and links to tests/evidence)
  3. Setup and run (versions, dependencies, local setup, inputs, expected results)
  4. Demo and access (live URL placeholders, demo account note — no passwords in repo, walkthrough steps matching the required demonstration)
  5. Architecture and decisions (links to docs)
  6. Verification and limitations (how to run tests, results, offline limits, recovery logic)
  7. Credits and contribution: libraries + licenses, and a complete, honest **AI assistance and contribution** section written by the agent (no placeholders). Describe it accurately:
     - **Candidate:** chose the Web lane, the field-inspection idea and target users; defined the requirements, acceptance criteria, stack, offline/sync approach, and phased plan (PLAN.md); directed and reviewed the AI's work; deployed the frontend and backend; ran the demo and verified the results.
     - **AI (Claude Code, by Anthropic):** generated most of the implementation code, tests, and documentation from PLAN.md, under the candidate's direction.
     - Point to PLAN.md, `docs/decisions.md`, and the commit history as the record of how the work was done. Do not overstate either side.
- `docs/architecture.md`: system diagram (Mermaid), component responsibilities, data flow for online write, offline write, sync, conflict.
- `docs/sync-protocol.md`: the §6 protocol in detail with sequence diagrams (Mermaid).
- `docs/decisions.md`: at least: IndexedDB vs localStorage, client-generated IDs, batch sync endpoint, idempotency via opId, version-based conflicts + user resolution, monorepo, hosting choice.
- `docs/demo-script.md`: step-by-step script for the live demo and the recording.
- **Exit:** docs consistent with code. Commit.

### Phase 11 — Final check
- Fresh clone simulation: follow README from zero, fix anything that doesn't work.
- Lint, all tests, builds pass. No secrets in the repo (scan).
- Update `PROGRESS.md` with final status and the "Needs human" list.
- Commit and create tag `v1.0.0`.

---

## 8. Definition of done
All phases complete, all tests green, README sections present, AC table filled with evidence links, `PROGRESS.md` lists only human-only remaining tasks (deploy, paste the live URLs into the README, record the demo video).
