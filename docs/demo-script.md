# Demo script

A 6–8 minute live demo (and the recording) that walks through every acceptance criterion. The same
scenarios run automatically in `npm run test:e2e`; screenshots from that run are in
[`evidence/`](evidence/).

## Setup (before the demo)

- **Hosted:** open `https://<api>/api/health` a minute early (Render free tier cold start).
  **Local:** `npm run db:up && npm run dev` with `DEMO_TOOLS=true` in `backend/.env`, or for offline
  steps use the production build: `npm run build && npm run preview -w frontend` (port 4173).
- Two browser windows side by side:
  - **Window A (phone-sized, Chrome DevTools device mode):** the inspector. DevTools open on the
    **Network** tab (to switch *Offline*) and **Application → IndexedDB** (to show stored data).
  - **Window B (incognito):** the supervisor.
- Demo accounts: `inspector@siteward.test` and `supervisor@siteward.test`. Passwords are the
  `SEED_*_PASSWORD` values you set at deploy time; they are not in the repository.
- Recording tip: zoom the header so the sync indicator is readable.

## 1. Sign in and roles (AC1, AC9)

1. A: submit the empty login form → "Email is required", "Password is required". Wrong password →
   "Email or password is incorrect".
2. A: sign in as the inspector → **Sites** list, header `Online · Synced`.
3. B: sign in as the supervisor → **Inspections** shows everyone's work with inspector names.
   Say: *access control is enforced by the server; an inspector's API token only ever returns their
   own inspections.* (Optional: show `GET /inspections` in Swagger with each token.)

## 2. Online workflow (AC2, AC9)

1. A: **Sites → New** on *Northgate Office Tower*. Rename the title. Point at `Saved on this device`
   and the header going `Online · 1 pending` → `Online · Synced`.
2. Tap **Submit inspection** immediately → the grouped error summary ("9 items need a result") and
   the messages under each item (AC9).
3. Mark items Pass, one **Fail** → submit again → "failed item needs a comment" → add a comment →
   **Submit**. The list shows *Submitted · Synced*.
4. Show the server copy: Swagger `GET /inspections/{id}` (or B's list) → `status: submitted`.
   Re-open it in A: read-only for the inspector.

## 3. Offline: open, edit, reload (AC3, AC4)

1. A: create another inspection at *Harbor Logistics Warehouse*, wait for `Synced`.
2. DevTools → Network → **Offline** (airplane mode). **Reload.** The app opens from the service
   worker, the dark offline banner appears, data is there (AC3).
3. Edit notes, mark two items. Header: `Offline · 1 pending`. Create a new inspection at *Riverside*.
   Header: `Offline · 2 pending`.
4. **Reload again** while offline: everything is still there (AC4). Show the `outbox` store in
   Application → IndexedDB.

## 4. Reconnect and sync (AC5)

1. Network → **No throttling** (online). Within a second: `Syncing…` → `Online · Synced`, banner gone.
2. B (supervisor) → Inspections → **Sync now** icon: the inspector's offline edits and new inspection
   are there with the same values (AC5).

## 5. Idempotency (AC6)

1. B: open `/?debug=1` → debug panel → **Lose next response** (the server will apply the next sync
   and then answer 500, as if the response was lost on a bad network).
2. A: open `/?debug=1`, edit something. Header: `Sync failed · Retry`. The outbox still holds the op
   (`tries=1 sent`) — but the server *did* apply it.
3. Wait 2 s (automatic retry) or tap the header → `Synced`. Debug **Last sync** shows `→ duplicate`:
   the server recognised the same `opId` and wrote nothing.
4. Tap **Force retry last batch** → `→ duplicate` again. Show in B or Swagger that there is still
   exactly one inspection and its version did not change.

## 6. Conflict (AC7)

1. A: open a synced draft. Network → **Offline**. Change the notes to "Inspector: gate 2 hinge broken".
2. B: open the same inspection, change the notes to "Supervisor: re-check gate 2 next week".
   (B saves online → server version goes up.)
3. A: go **online**. Header turns red: `1 conflict`. Tap it → *Needs attention* → the inspection →
   **Resolve sync conflict**: *Your version* vs *Server version*, the differing field highlighted.
   Nothing was overwritten.
4. Tap **Keep mine** → `Synced`; B → Sync now: the inspector's note is on the server (new version).
   (Repeat with **Keep server** to show the other path.)

## 7. Failed sync and recovery (AC8)

1. B (debug panel): **Fail next sync** (or, locally, stop the backend process).
2. A: edit something. Header: `Sync failed · Retry`; debug panel shows `phase=failed`, retry
   countdown, the op still in the outbox with its error. Reload: the change is still there.
3. Tap **Sync failed · Retry** (or wait for the backoff) → `Online · Synced`. Show the change on the
   server.

## 8. Hosting and API docs (AC10)

1. Show the two URLs: Vercel (frontend) and Render (API), both `https://`.
2. Open `https://<api>/api/docs`: Swagger UI with `/sync`, `/inspections`, the error shape and the
   per-op result table.

## Closing line

*Every change is written to the device first, queued with an id the server remembers, and only
overwritten by a human decision. The tests for each step are in `e2e/tests/` and the evidence is in
`docs/evidence/`.*
