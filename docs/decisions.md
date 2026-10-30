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
