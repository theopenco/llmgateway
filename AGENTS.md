# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Skills

Area-specific rules live in skills under `.agents/skills`. Load the matching skill before working in its area:

| Skill              | Use for                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `local-stack`      | Isolated per-worktree Postgres, Redis, and app ports; `.envrc`; starting and tearing down stacks |
| `testing`          | Unit and e2e tests, seeded accounts and tokens, provider pinning, test fixtures                  |
| `verify`           | Launching and driving the stack to verify a change, screenshots                                  |
| `database`         | Schema, Drizzle and raw SQL, analytics queries, aggregation tables                               |
| `migrations`       | Generating, editing, and resolving conflicts in migrations                                       |
| `gateway`          | `apps/gateway` request path, routing, error classification, logging, user-supplied URLs          |
| `add-model`        | Everything in `packages/models`: mappings, pricing, capabilities, deactivation                   |
| `billing`          | Org kinds, plans, Stripe, DevPass, credits, cost math, audit log, org emails                     |
| `frontend`         | Next.js apps: API client, data fetching, navigation, dashboard routes, formatting                |
| `infrastructure`   | Production hosting and hostnames, deploy ordering, client IP and country                         |
| `legal-pages`      | Terms, privacy policy, and product supplemental terms                                            |
| `pull-request`     | Opening and updating PRs, screenshots, stacked PRs, CI e2e                                       |
| `model-benchmarks` | Model and mapping benchmarks                                                                     |
| `changelog`        | Changelog entries                                                                                |
| `blog`             | Marketing blog posts                                                                             |
| `knowledge-base`   | Docs knowledge base pages                                                                        |
| `core-web-vitals`  | Frontend performance                                                                             |
| `skill-authoring`  | Creating or editing skills                                                                       |
| `security-audit`   | Secure-by-default code, security reviews, full audits, the monthly audit routine                 |

## Development Commands

Run all `pnpm` commands from the repository root, not from app directories.

- `pnpm install` - Install all dependencies
- `pnpm setup` - Full development environment setup (starts Docker, syncs DB, seeds data)
- `docker compose up -d` - Start PostgreSQL and Redis services
- `pnpm wait-for-services` - Block until Postgres (including the `test` database) and both Redis instances accept connections. Run it before `pnpm push`/`pnpm seed` after starting the stack.
- `pnpm dev` - Start all development servers (UI :3002, Playground :3003, Code :3004, Docs :3005, Admin :3006, Airside :3007, Gateway :4001, API :4002; Postgres :5432, Redis :6379, storage Redis :6479). Worktrees use offset ports — see the `local-stack` skill.
- `pnpm build` - Build everything. ALWAYS run a full build after finishing a feature.
- `pnpm clean` - Clean build artifacts and cache directories
- `pnpm test:unit` / `pnpm test:e2e` - Unit (`*.spec.ts`) and e2e (`*.e2e.ts`) tests. Run unit tests after adding features, ALWAYS against the worktree's own isolated database (`local-stack` skill); details in the `testing` skill.

To build a single app, ALWAYS use a Turbo filter (`turbo run build --filter=<app>`). NEVER use `pnpm --filter <app> build`: it skips rebuilding workspace dependencies and compiles against stale `dist/` artifacts.

`apps/api` and `apps/gateway` build with plain `tsc` (`tsc && resolve-tspaths`) and run `node dist/serve.js` — there is no bundler. Only the Next.js frontends have one.

### Code Quality

ALWAYS run `pnpm format` before committing. It auto-fixes, so prefer it over `pnpm lint`. `format` runs prettier after `eslint --fix` without re-running eslint, so run `pnpm lint` once before pushing; fix rules the two disagree on (e.g. `no-mixed-operators`) by restructuring, such as hoisting `SECONDS * 1000` into a named const.

### Writing code

This is a pure TypeScript project. Never use `any` or `as any` unless absolutely necessary.
This repository always uses tabs for indentation.

When you are done writing code features or bug fixes, ALWAYS commit your changes. If in doubt, commit any changes.

Keep everything you write short and concise — code comments, docs, skills, commit messages, PR descriptions. Say a thing once, at the level of detail a reader needs to act on it. Do not elaborate beyond that, do not restate a rule that already lives elsewhere, and do not add filler like "apply the usual rules" that carries no information.

Persist durable learnings about this repository in `AGENTS.md` (repo-wide rules) or the matching skill (area rules), not in local agent memory. Keep local memory for facts specific to a machine, user, or credential that do not belong in a public repository.

Keep scratch files (PR bodies, logs) under the worktree's `.context/`; `/tmp` is shared with other agents. Set work aside with a WIP commit rather than `git stash`; lint-staged adds its own stash entries.

### Documentation

- ALWAYS update affected `apps/docs` pages in the same PR as user-visible behavior changes. For routing changes, update `apps/docs/content/(gateway)/features/routing.mdx` and review session and DevPass guidance for pricing, learning thresholds, overrides, fallback, and pinning behavior. Check the prose against the final implementation before handoff.
- NEVER hardcode a list of models, providers, provider countries/headquarters, or any other catalogue-derived enumeration into documentation (`apps/docs`), changelog entries, or marketing copy. Link to the live [models page](https://llmgateway.io/models) or [providers page](https://llmgateway.io/providers) instead.
- The ONLY exception is video and image generation models: list those models and their per-model constraints (sizes, durations, resolutions) in the docs.

## Architecture Overview

**LLM Gateway** is a monorepo containing a full-stack LLM API gateway:

- **Gateway** (`apps/gateway`) - LLM request routing and provider management (Hono + Zod + OpenAPI)
- **API** (`apps/api`) - Backend API for user management, billing, analytics (Hono + Zod + OpenAPI)
- **Worker** (`apps/worker`) - Background jobs: billing, stats aggregation, retention
- **UI** (`apps/ui`) - Frontend dashboard (Next.js App Router)
- **Playground** (`apps/playground`) - Interactive LLM testing environment (Next.js App Router)
- **Code** (`apps/code`) - Dev plans + coding tools landing & dashboard (Next.js App Router)
- **Airside** (`apps/airside`) - Self-serve provider portal (Next.js App Router)
- **Docs** (`apps/docs`) - Documentation site (Next.js + Fumadocs)
- **Admin** (`ee/admin`) - Internal admin dashboard (Enterprise License)
- **Packages**: `packages/db` (Drizzle schema and migrations), `packages/models` (model and provider catalogue), `packages/actions` (shared request/cost logic), `packages/shared` (shared utilities and components), `packages/cache` (Redis)

Production domain mapping (counterintuitive): `api.llmgateway.io` serves `apps/gateway`, and `internal.llmgateway.io` serves `apps/api`. Production runs entirely on GCP; see the `infrastructure` skill.

Stack: Hono, PostgreSQL with Drizzle ORM, Redis, Better Auth (with passkeys), Zod, Next.js App Router with TanStack Query, Radix UI and Tailwind, Turbo with pnpm workspaces, Vitest, ESLint, Prettier.

When creating a package in `packages/`, copy `package.json`, `tsconfig.json`, `.prettierignore`, `.lintstagedrc.json`, and `eslint.config.mjs` from an existing package such as `packages/models`.

## Code Standards

- When proxying a request on a caller's behalf, including in-process `app.request()` calls, spread `forwardedIpHeaders(incomingHeaders)` from `@llmgateway/shared/client-ip` into the forwarded headers. Preserve only the configured client-IP header; never substitute another header or the proxy address. Cover the internal hop with an IP-rule regression test.
- Always use the internal api (`apps/api/`) for backend operations, never Next.js API routes or server actions that wrap it. Mutate from the browser with the typed client (`$api.useMutation`); use a server API client only for SSR reads.
- Never suppress errors with a silent `.catch(() => [])`, `.catch(() => ({}))`, or another empty/default fallback. Handle a deliberate recovery in the owning helper with explicit logging and last-known-good data when available; otherwise let the error propagate.
- Do not use broad try/catch in API handlers unless to check for specific errors; let errors propagate to the global error handler.
- Always use top-level `import`, never `require`. Dynamic imports are allowed only for the optional Jelly scene in `packages/shared/src/components/jelly/jelly-logo.tsx` and the DevPass card form in `apps/code/src/app/dashboard/components/DevPassPaymentMethod.tsx`.
- Apply DRY principles; when a helper exists in one app, extract it into a shared package instead of copying it.
- Do not add caching or memoization around `process.env` reads unless there is a measured hot-path need.
- Always use pnpm for package management.
- Security gating is enforced server-side; UI gates are UX only.
- Hash or HMAC with an existing deployment secret — `getApiKeyHashSecret()` from `@llmgateway/shared/api-key-hash`, with a domain-separation prefix. New secrets come from required env vars with no default value.
- Do all money math with `Decimal` from `decimal.js`.
- NEVER query the `log` table from the gateway request path, and never fetch a user-supplied URL with a bare `fetch()` — see the `gateway` skill.
- `log` can hold billions of rows of high-throughput, sensitive data (prompts and completions). Load the `database` skill before adding any `log` read.
- Models and provider mappings on `origin/main` are never removed, only deactivated — see the `add-model` skill.

### Public repository

NEVER put internal or private information into anything published to this public repository — commit titles and bodies, branch names, PR titles and descriptions, PR/issue comments, code comments, changelog entries, or docs. Never include real user or customer names, email addresses, customer/partner/company names, organization/project/user IDs, API keys, tokens, secrets or credentials (including partial or redacted-looking values), dollar amounts (revenue, credit balances, spend, invoice totals, contract values), internal dashboards, internal ticket/Slack/Linear links, or internal infrastructure hostnames. Describe the situation generically ("a customer organization", "a large credit balance"). Seeded fixtures already in the repo (`admin@example.com`, `test-token`, `Test Organization`) and public provider pricing from `packages/models` are fine.

### Git and pull requests

- Use conventional commit format for commits and PR titles, max 50 characters.
- Do not `--amend` commits after pushing. Force-push only feature branches, never main.
- When checking out an existing PR or remote branch, set its upstream (`gh pr checkout <n>`, or `git checkout -B <branch> FETCH_HEAD && git branch --set-upstream-to=origin/<branch>`).
- Sync a feature branch with main via a merge commit; rebase only when required or clearly better, and say why.
- Resolve `pnpm-lock.yaml` conflicts by running `pnpm install`.
- Use the `pull-request` skill for opening and updating PRs. PRs are ready for review (not drafts) unless the user asks otherwise, and their title and description always reflect the final scope. Split independently reviewable layers into native stacked PRs with `gh stack`.

## License

Core functionality is AGPLv3 ([LICENSE](LICENSE)); commercial features in `ee/` require an Enterprise license ([ee/LICENSE](ee/LICENSE)). For enterprise licensing, contact contact@llmgateway.io.
