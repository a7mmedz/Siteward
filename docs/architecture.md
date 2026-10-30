# Architecture

Siteward is an offline-first PWA (React) talking to a small JSON API (Express + Prisma + PostgreSQL).
The one rule that shapes everything: **the UI only reads and writes IndexedDB; the sync engine is
the only thing that talks to the server about data.**

## System

```mermaid
flowchart LR
  subgraph Device["Inspector's phone / browser"]
    UI["React UI<br/>pages + components"]
    Repo["Repository<br/>data/repository.ts"]
    IDB[("IndexedDB (Dexie)<br/>inspections · sites · outbox · meta")]
    Engine["Sync engine<br/>sync/engine.ts"]
    SW["Service worker (Workbox)<br/>precached app shell"]
    LS[("localStorage<br/>JWT only")]
    UI -- "useLiveQuery (read)" --> IDB
    UI -- "save / delete / resolve" --> Repo
    Repo -- "record + outbox op<br/>(one transaction)" --> IDB
    Engine <--> IDB
    Engine -.reads token.- LS
    SW -. "serves HTML/JS/CSS/fonts offline" .- UI
  end

  subgraph Vercel["Vercel (HTTPS)"]
    Static["Static build<br/>index.html, assets, sw.js"]
  end

  subgraph Render["Render (HTTPS)"]
    API["Express API<br/>helmet · CORS · pino · Zod"]
    Sync["/sync service<br/>sync/service.ts"]
  end

  DB[("PostgreSQL (Neon)<br/>User · Site · Inspection<br/>ProcessedOp · ChecklistTemplate")]

  Static -- "first visit / updates" --> SW
  Engine -- "POST /api/sync (push)<br/>GET /api/inspections?updatedSince (pull)" --> API
  UI -- "POST /api/auth/login (needs network)" --> API
  API --> Sync
  API --> DB
  Sync --> DB
```

## Components

| Component | Where | Responsibility |
|---|---|---|
| Pages & components | `frontend/src/pages`, `frontend/src/components` | Render from IndexedDB via `useLiveQuery`; never call data endpoints. |
| Repository | `frontend/src/data/repository.ts` | The only writer: each change updates the record **and** appends/coalesces an outbox op in one Dexie transaction; conflict resolution (keep mine / keep server). |
| Validation | `frontend/src/data/validation.ts`, `backend/src/lib/validation.ts` | Same Zod rules and messages on both sides (ADR-008). |
| Sync engine | `frontend/src/sync/engine.ts` | Push outbox → handle per-op results → pull changes. Lock, triggers, backoff, 401 handling, debug replay. |
| Status | `frontend/src/sync/status.ts`, `components/SyncIndicator.tsx` | Engine state + live counts → header label (`Online · Synced`, `Offline · 3 pending`, …). |
| Auth | `frontend/src/auth/AuthProvider.tsx` | Login (online), cached user for offline boot, re-auth after expiry without losing data, sign-out clears the device. |
| Service worker | `frontend/vite.config.ts` (vite-plugin-pwa) | Precache app shell, SPA fallback, update prompt. No API caching. |
| API app | `backend/src/app.ts` | Security headers, CORS allow-list, JSON limit, logging, auth middleware, routes, error shape. |
| Sync service | `backend/src/sync/service.ts` | §6 server rules: idempotency via `ProcessedOp`, permission + validation, compare-and-set on `version`. |
| Read routes | `backend/src/routes/*.ts` | `auth`, `sites`, `checklist-template`, `inspections` (incremental pull), `health`, `docs`, demo tools. |

## Data model

```mermaid
erDiagram
  User ||--o{ Inspection : "inspects"
  Site ||--o{ Inspection : "has"
  User {
    uuid id
    string email
    string name
    string passwordHash
    enum role "inspector | supervisor"
  }
  Site {
    uuid id
    string name
    string address
  }
  Inspection {
    uuid id "client-generated"
    uuid siteId
    uuid inspectorId
    string title
    string notes
    enum status "draft | submitted"
    json items "[{id,label,result,comment}]"
    int version "+1 per server write"
    datetime updatedAt
    datetime deletedAt "soft delete"
  }
  ProcessedOp {
    uuid opId "idempotency key"
    uuid userId
    json result "{entityId, version}"
  }
  ChecklistTemplate {
    uuid id
    json items
    bool isDefault
  }
```

## Data flows

### Online write

```mermaid
sequenceDiagram
  actor U as Inspector
  participant UI
  participant R as Repository
  participant DB as IndexedDB
  participant E as Sync engine
  participant API
  U->>UI: taps "Fail", types a comment
  UI->>R: saveInspection (after 500 ms autosave debounce)
  R->>DB: tx { put record (pending), add/merge outbox op }
  DB-->>UI: live query → "Pending"
  R->>E: notifyLocalChange (debounced 800 ms)
  E->>API: POST /sync [op]
  API-->>E: applied, record v2
  E->>DB: tx { delete op, put server copy (synced) }
  DB-->>UI: "Online · Synced"
```

### Offline write

Identical up to the outbox. `syncNow` sees `navigator.onLine === false` and returns; the header shows
`Offline · N pending`. Records and ops are in IndexedDB, so they survive reloads and restarts; the
service worker serves the app shell. On the `online` event the engine syncs immediately.

### Sync (push, then pull)

```mermaid
flowchart TD
  T["Trigger: start · online event · 30 s timer · local change · Sync now"] --> L{"Already running?"}
  L -- yes --> Q["Queue one follow-up run"]
  L -- no --> B["nextBatch(): outbox in order,<br/>≤ 50 ops, ≤ 1 op per record,<br/>skip records with a parked op"]
  B --> E{"Empty?"}
  E -- no --> P["POST /sync"]
  P -- "network error / 5xx" --> F["attempts++, keep ops,<br/>'Sync failed · Retry',<br/>retry in 2s, 4s, 8s … 60s"]
  P -- 401 --> A["keep ops, 'Sign in to sync'"]
  P -- 200 --> H["Per result:<br/>applied/duplicate → drop op, store server copy, rebase follow-ups<br/>conflict → park op, keep serverCopy<br/>rejected → drop record's ops, mark error"]
  H --> B
  E -- yes --> PU["GET /inspections?updatedSince=lastPulledAt<br/>(skip records with unsynced work)"]
  PU --> D["'Online · Synced'"]
```

### Conflict

A supervisor edits inspection v1 → v2 while the inspector, offline, edits based on v1. On reconnect
the inspector's op carries `baseVersion: 1`; the server's compare-and-set fails and it answers
`conflict` with `serverCopy` v2. Nothing is overwritten. The record turns red (`1 conflict`); the
conflict screen shows both versions side by side. **Keep mine** deletes the parked op and enqueues a
new op with `baseVersion: 2` (→ v3). **Keep server** deletes the op and stores v2 locally. Details:
[sync-protocol.md](sync-protocol.md).

## Security notes

- Passwords: bcrypt (cost 10). Login is rate-limited and does not reveal whether an email exists.
- JWT (HS256, 7 days) in `Authorization` headers; the user is reloaded from the DB on every request.
- Access control is enforced on the server for every read and write (inspectors: own records only).
- Helmet headers (HSTS, CSP for API/Swagger, nosniff, frame-ancestors), CORS allow-list, 2 MB body
  limit, Zod validation of every input, one error shape without stack traces.
- Signing out clears IndexedDB; a different user signing in on the same device clears the previous
  user's data (with an explicit warning when unsynced changes would be lost).
