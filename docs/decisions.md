# Architecture decision records

Short ADRs: context, decision, alternative considered, tradeoff. Newest decisions are appended at the end.

---

## ADR-001 — Monorepo with npm workspaces

- **Context:** Frontend, backend, end-to-end tests and docs evolve together and must stay consistent.
- **Decision:** One repository with npm workspaces `backend/`, `frontend/`, `e2e/`. `docs/` is a plain folder, not a workspace, because it has no package to install or build.
- **Alternative:** Separate repositories, or Turborepo/Nx.
- **Tradeoff:** Simple and atomic commits across layers; no build caching or task graph, which a two-day project does not need.

## ADR-002 — Pinned toolchain versions

- **Context:** Several libraries had new majors at build time (TypeScript 7, Prisma 7/8).
- **Decision:** TypeScript `~5.9` (typescript-eslint supports `<6.1`), Prisma `~6.19` (classic `prisma-client-js` generator, no driver adapter), ESLint 9, Express 5, Zod 4, React 19, React Router 7, Vite 8, Vitest 5, Tailwind 4.
- **Alternative:** Latest everything.
- **Tradeoff:** Boring, well-documented versions with stable tooling; a later upgrade pass is needed.

## ADR-003 — npm install-script allowlist

- **Context:** npm 11 blocks dependency install scripts unless approved.
- **Decision:** Approve `esbuild`, `prisma`, `@prisma/engines` in `allowScripts` (root `package.json`). Deny `@prisma/client`'s postinstall because the backend runs `prisma generate` explicitly in `postinstall` and `build`.
- **Tradeoff:** Explicit supply-chain review; new packages with scripts need a conscious approval.

## ADR-004 — Local Postgres on port 5433 with three databases

- **Context:** Developers may already run Postgres on 5432; tests must not wipe dev data.
- **Decision:** Docker Compose maps Postgres 16 to `localhost:5433` and creates `siteward` (dev), `siteward_test` (Vitest) and `siteward_e2e` (Playwright). The local `siteward/siteward` credentials only exist inside the local container.
- **Tradeoff:** One more port to remember; tests are isolated and repeatable.

## ADR-005 — Low-severity audit findings accepted

- **Context:** `npm audit` reports 4 low-severity advisories (`deepmerge`, `deepmerge-ts`) reached only through build-time tooling (`@prisma/config`, `workbox-build`).
- **Decision:** Accept them; do not `npm audit fix --force` (it downgrades/breaks majors). They never ship to the browser or run on untrusted input.
- **Tradeoff:** Audit is not "zero"; revisit when upstream releases fixes.

## ADR-006 — Checklist template table and endpoint

- **Context:** The plan seeds a "default checklist template" but the §4 model has no place for it, and the client must be able to create inspections offline.
- **Decision:** Add a `ChecklistTemplate` table (seeded) and `GET /api/checklist-template`. The client caches the template in IndexedDB `meta` so new inspections can be created offline. Each inspection stores a full copy of its items, so later template changes never rewrite old inspections.
- **Alternative:** Hard-code the template in the frontend.
- **Tradeoff:** One extra table and endpoint; the template stays server-owned and editable without a frontend release.

## ADR-007 — Authentication details

- **Context:** Inspectors work offline for long stretches; tokens must outlive a day in the field.
- **Decision:** HS256 JWT (`sub`, `role`), default lifetime `7d` (`JWT_EXPIRES_IN`). The middleware reloads the user on every request so deleted users and role changes apply immediately. Login uses a dummy bcrypt comparison for unknown emails (no user enumeration through timing) and is rate-limited (`LOGIN_RATE_LIMIT` per 15 min per IP; set `TRUST_PROXY=1` behind Render's proxy).
- **Alternative:** Short-lived access token + refresh token.
- **Tradeoff:** Simpler, works offline; a stolen token is valid until expiry (mitigated by HTTPS and the short scope of the app). Stored in localStorage (see ADR on client storage).

## ADR-008 — Validation rules duplicated on client and server

- **Context:** AC9 needs clear validation messages on both sides. A shared package would need extra build wiring for Render (tsc) and Vercel (Vite).
- **Decision:** The same Zod rules live in `backend/src/lib/validation.ts` and `frontend/src/data/validation.ts`, with matching messages. The server is authoritative; the client copy gives instant feedback offline.
- **Alternative:** A `shared/` workspace package.
- **Tradeoff:** Two small files to keep in sync (both are covered by tests), no cross-package build step.

## ADR-009 — Hidden vs forbidden

- **Context:** An inspector asking for another inspector's inspection by id.
- **Decision:** Respond `404 NOT_FOUND`, the same as a missing id, so ids of other people's work are not confirmed. Writes to someone else's inspection through `/sync` are `rejected` with code `FORBIDDEN` (the client needs to know why its change was refused).
- **Tradeoff:** Slightly less explicit for reads; no information leak.
