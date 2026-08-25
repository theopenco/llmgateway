# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Development Commands

### Setup and Dependencies

- `pnpm install` - Install all dependencies
- `pnpm setup` - Full development environment setup (starts Docker, syncs DB, seeds data)
- `docker compose up -d` - Start PostgreSQL and Redis services
- `pnpm wait-for-services` - Block until Postgres (including the `test` database) and both Redis instances actually accept connections. `docker compose up -d` returns long before Postgres finishes initdb, so run this before `pnpm push`/`pnpm seed` in any script that just started the stack. Waits up to 3 minutes (`WAIT_TIMEOUT`), retrying every 2 seconds (`WAIT_INTERVAL`), and respects the per-worktree port/`STACK_SUFFIX` env vars.

### Development

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm dev` - Start all development servers (UI on :3002, Playground on :3003, Code on :3004, API on :4002, Gateway on :4001, Docs on :3005, Admin on :3006). Every one of these ports, plus Postgres/Redis, is overridable per worktree — see "Running an isolated stack per worktree".
- `pnpm build` - Build all applications for production. ALWAYS run this after finishing work on a feature. ALWAYS run a full build to make sure things fork.
- `pnpm clean` - Clean build artifacts and cache directories

To build a single app, ALWAYS use a Turbo filter (`turbo run build --filter=<app>`), e.g. `turbo run build --filter=gateway`. NEVER use `pnpm --filter <app> build` for builds: that runs the app's `tsc` directly without rebuilding workspace dependency packages first, so it compiles against stale `dist/` artifacts and produces spurious errors (missing `@llmgateway/*` modules, "value not in type union", etc.). Turbo's `build` depends on `^build`, so a Turbo filter builds the dependency packages in topological order first.

Note: `apps/api` and `apps/gateway` build with plain `tsc` (`tsc && resolve-tspaths`) and run `node dist/serve.js` — there is no bundler. Bundler concepts like "mark a dependency as external" do not apply to these apps; runtime dependencies are ordinary `node_modules` imports. Only the Next.js frontends have a bundler.

### Code Quality

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

ALWAYS run `pnpm format` before committing code. Run `pnpm build` if API routes were modified.

- `pnpm format` - Format code and fix linting issues. ALWAYS run this before committing code.
- `pnpm lint` - Check linting and formatting (without fixing)

ALWAYS prefer `pnpm format` over `pnpm lint`. They check the same rules, but
`format` auto-fixes what it can, so running `lint` first just reports problems
you would then have to fix by hand. Reach for `lint` only when you specifically
need a read-only check (e.g. verifying CI would pass without touching files).

### Writing code

This is a pure TypeScript project. Never use `any` or `as any` unless absolutely necessary.
This repository always uses tabs for indentation.

When you are done writing code features or bug fixes, ALWAYS commit your changes. If in doubt, commit any changes.

Keep everything you write short and concise — code comments, docs, skills, commit messages, PR descriptions. Say a thing once, at the level of detail a reader needs to act on it. Do not elaborate beyond that, do not restate a rule that already lives elsewhere, and do not add filler like "apply the usual rules" that carries no information.

Use the local `skill-authoring` skill when creating or editing repository skills.

### Documentation

- NEVER hardcode a list of models, providers, provider countries/headquarters, or any other catalogue-derived enumeration into documentation (`apps/docs`), changelog entries, or marketing copy. These lists go stale the moment the catalogue changes and are annoying to keep in sync. Instead, link to the relevant live page that is generated from the catalogue (e.g. the [models page](https://llmgateway.io/models) or [providers page](https://llmgateway.io/providers)).
- The ONLY exception is video generation and image generation models: their per-model requirements (supported sizes, durations, resolutions, etc.) are how users figure out how to call them, so listing those specific models and their constraints in the docs is acceptable and preferred there.

### Legal pages

- The Terms of Use and Privacy Policy are not single documents: the base versions live in `apps/ui/src/content/legal/` and each product layers **supplemental terms and policies** on top — most importantly DevPass, at `apps/code/src/app/legal/terms/page.tsx` and `apps/code/src/app/legal/privacy/page.tsx`. When changing anything in a legal page, ALWAYS check the supplemental documents for the same change and apply it consistently; a fact stated only in the base terms (company details, contact address, retention behaviour, plan rules) leaves the DevPass version stale and contradictory. Grep all of `apps/*/src/**/legal` before concluding a legal edit is complete.

### Testing

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

Do not run test files or suites in parallel unless the repository instructions for that exact suite explicitly require it. Some gateway and worker tests share ports, databases, and process state, so parallel test runs can produce false failures.

- `pnpm test:unit` - Run unit tests (\*.spec.ts files)
- `pnpm test:e2e` - Run end-to-end tests (\*.e2e.ts files)

ALWAYS bring up an isolated database for the current worktree before running unit tests, and point the tests at it. Several workspaces on this machine share the default Postgres/Redis ports, so a run against the shared stack will race another workspace's schema push and seed data and produce shifting, false failures. Concretely:

1. Give the worktree its own compose stack and `TEST_DATABASE_URL` — see "Running an isolated stack per worktree" below for the `STACK_SUFFIX` / port block to put in `.envrc`.
2. `docker compose up -d && pnpm wait-for-services && pnpm push-test` (or just `pnpm setup`) so your own `test` database exists and has the current schema.
3. Run `pnpm test:unit` with `TEST_DATABASE_URL` exported so it targets that isolated database and never the shared one.

When running curl commands against the local API, you can use `test-token` as authentication. To exercise retention-off behavior, use `test-token-no-retention` instead — it belongs to a seeded sibling org with `retentionLevel: "none"` (the default `test-token` org retains all data for easier debugging).

Every seeded account's password is its own email address (password == email). For example, log into the dashboard as `admin@example.com` with the password `admin@example.com`. This applies to all users created by `packages/db/src/seed.ts`, including:

- `admin@example.com` — default test admin (owns "Test Organization", "Test No Retention Organization" + a DevPass Pro workspace)
- `enterprise@example.com` — owner of the enterprise org
- `developer@example.com` — project-scoped developer in the enterprise org (RBAC testing)
- the bulk demo users such as `alice.chen@techcorp.io`, `bob@startupinc.com`, etc.

To test a specific provider in isolation (e.g. to reproduce a provider-specific failure without the gateway silently falling back to a healthy provider), pin the provider with the `provider/model` model string and disable fallback with the `x-no-fallback: true` header:

```bash
curl -N http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer test-token" -H "x-no-fallback: true" \
  -d '{"model":"embercloud/minimax-m2.5","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

Without `x-no-fallback`, a failing pinned provider falls back to the next healthy provider, masking the error. Also note that the gateway caches responses (including errors) in Redis keyed on the request body, so vary the prompt when re-testing the same failure.

Caveat: if you run multiple git worktrees (e.g. conductor workspaces), only one stack at a time can own :4001 / :5432 / :6379 — confirm which working tree is actually serving a port (`lsof -a -p <pid> -d cwd -Fn`) before assuming your local edits are live. Rather than fighting over the defaults, give the worktree its own isolated stack (below).

#### Running an isolated stack per worktree (own Postgres, Redis, and app ports)

Every host-facing port and every Docker name is env-var driven, and all defaults reproduce the historical single shared stack — a worktree that sets nothing behaves exactly as before. Set the block below and that worktree gets its **own** Postgres, Redis, storage Redis, and app ports, so `pnpm setup`, `pnpm dev`, and `pnpm test:unit` in one workspace cannot touch another's data or ports.

Pick a **slot** number per worktree (1, 2, 3 …) and offset every port by it:

| Component            | Env var              | Default | Slot _N_        | Slot 1 |
| -------------------- | -------------------- | ------- | --------------- | ------ |
| Postgres (host port) | `POSTGRES_PORT`      | 5432    | 5432 + N × 100  | 5532   |
| Redis                | `REDIS_PORT`         | 6379    | 6379 + N × 1000 | 7379   |
| Storage Redis        | `STORAGE_REDIS_PORT` | 6479    | 6479 + N × 1000 | 7479   |
| Gateway              | `GATEWAY_PORT`       | 4001    | 4001 + N × 100  | 4101   |
| Gateway metrics      | `METRICS_PORT`       | 9090    | 9090 + N × 100  | 9190   |
| API                  | `API_PORT`           | 4002    | 4002 + N × 100  | 4102   |
| UI                   | `UI_PORT`            | 3002    | 3002 + N × 100  | 3102   |
| Playground           | `PLAYGROUND_PORT`    | 3003    | 3003 + N × 100  | 3103   |
| Code                 | `CODE_PORT`          | 3004    | 3004 + N × 100  | 3104   |
| Docs                 | `DOCS_PORT`          | 3005    | 3005 + N × 100  | 3105   |
| Admin                | `ADMIN_PORT`         | 3006    | 3006 + N × 100  | 3106   |

The Redis pair uses a ×1000 offset on purpose: with ×100, slot 1's Redis would land on 6479, which is the _default_ storage-Redis port of another worktree.

Put the block in the worktree's **`.envrc`** (gitignored, per worktree, loaded by direnv — run `direnv allow` after editing). `.envrc` and not `.env`, because exported shell vars reach everything: `docker compose` interpolation, `drizzle-kit`, `vitest`, and the `pnpm dev` processes. Node's `--env-file` never overrides an already-exported var, so these also win over `.env` for the api/gateway/worker dev servers.

```bash
# --- isolated stack: worktree "tel-aviv", slot 1 ---
export STACK_SUFFIX=-tel-aviv      # compose project + container name suffix (include the separator)
export POSTGRES_PORT=5532
export REDIS_PORT=7379
export STORAGE_REDIS_PORT=7479

export DATABASE_URL=postgres://postgres:pw@localhost:5532/db
export TEST_DATABASE_URL=postgres://postgres:pw@localhost:5532/test

export GATEWAY_PORT=4101
export METRICS_PORT=9190
export API_PORT=4102
export UI_PORT=3102
export PLAYGROUND_PORT=3103
export CODE_PORT=3104
export DOCS_PORT=3105
export ADMIN_PORT=3106

# URLs the services hand to each other / render into pages
export API_URL=http://localhost:4102
export UI_URL=http://localhost:3102
export APP_URL=http://localhost:3102
export GATEWAY_URL=http://localhost:4101
export PLAYGROUND_URL=http://localhost:3103
export DOCS_URL=http://localhost:3105
export ADMIN_URL=http://localhost:3106
export ORIGIN_URLS=http://localhost:3102,http://localhost:3103,http://localhost:3104,http://localhost:3105,http://localhost:3106,http://localhost:4102
```

Then the normal commands just work, scoped to this worktree:

```bash
docker compose up -d          # project llmgateway-tel-aviv, containers postgres-tel-aviv, redis-tel-aviv, …
pnpm setup                    # down -v + up + wait-for-services + push-test + push-dev + seed — only your own stack
pnpm dev                      # every app on its offset port
curl http://localhost:4101/v1/chat/completions -H "Authorization: Bearer test-token" ...
```

ALWAYS tear the stack down once the work is finished — but ONLY when you started a worktree-specific one yourself (a `STACK_SUFFIX` stack, i.e. containers named `postgres-<suffix>` / `redis-<suffix>`). These containers otherwise sit around consuming memory and holding ports for every worktree that ever ran tests, and there are usually many worktrees on this machine:

```bash
docker compose down -v        # only this worktree's project, thanks to STACK_SUFFIX
```

NEVER run this against the default shared stack (no `STACK_SUFFIX` set): those containers are the user's own development database, another worktree may be serving from them, and `-v` destroys the volumes. If you did not bring the stack up in this session, leave it running.

How the wiring works:

- **Docker isolation**: `docker-compose.yml` derives both the compose project name (`llmgateway${STACK_SUFFIX}`) and each `container_name` from `STACK_SUFFIX`, and publishes `${POSTGRES_PORT}`/`${REDIS_PORT}`/`${STORAGE_REDIS_PORT}`. Because the project name differs, `docker compose down -v` and `pnpm setup` only destroy your own containers and the `redis_storage_data` volume of your own project. Address containers via `docker compose exec postgres …` (service name, resolved within your project) rather than `docker exec postgres …`.
- **Databases**: apps read `DATABASE_URL`; tests read `TEST_DATABASE_URL` (falling back to `DATABASE_URL`, then `postgres://postgres:pw@localhost:5432/test`). Always set **both** — `TEST_DATABASE_URL` is what stops `pnpm test:unit` from wiping the dev database once `DATABASE_URL` is exported, and it is what `pnpm push-test` pushes the schema to.
- **Redis**: `packages/cache` reads `REDIS_HOST`/`REDIS_PORT` and `STORAGE_REDIS_HOST`/`STORAGE_REDIS_PORT`. Setting any `STORAGE_REDIS_*` var opts into the separate storage instance, so set `STORAGE_REDIS_PORT` even if the value is the default-shaped one.
- **Service ports**: gateway and api both fall back to `PORT`, so never export `PORT` for an isolated stack — use `GATEWAY_PORT` and `API_PORT`, which take precedence. A second gateway also needs `METRICS_PORT` or it fails with `EADDRINUSE` on :9090. The Next.js `dev` scripts read `UI_PORT`/`PLAYGROUND_PORT`/`CODE_PORT`/`DOCS_PORT`/`ADMIN_PORT` with the historical ports as defaults.
- **Auth + CORS**: the API reads `ORIGIN_URLS` (comma-separated CORS/better-auth trusted-origins allowlist; defaults to `localhost:3002..3006,4002`) and `UI_URL`. If you relocate a frontend you MUST add its new origin to `ORIGIN_URLS` or login/API calls fail CORS. Login itself works across ports because the better-auth session cookie is host-only for `localhost` (shared across all ports) — no `COOKIE_DOMAIN` change needed.
- **Frontends → backends**: every frontend resolves the backend from `API_URL` (default `http://localhost:4002`) and the gateway from `GATEWAY_URL`, read server-side in `apps/*/src/lib/config-server.ts`.

If you only need one relocated service rather than a whole isolated stack, prefix the vars on the command line instead — same precedence rules apply:

```bash
( cd apps/api && API_PORT=4102 API_URL=http://localhost:4102 UI_URL=http://localhost:3102 \
    ORIGIN_URLS=http://localhost:3102,http://localhost:4102 \
    node --enable-source-maps --env-file=../../.env dist/serve.js )   # build first: turbo run build --filter=api
```

Running the built `dist/serve.js` gives no watch (rebuild + restart after code changes); use the app's `dev` script if you want tsc-watch.

#### E2E Test Options

- `TEST_MODELS` - Run tests only for specific models (comma-separated list of `provider/model-id` pairs)
  Example: `TEST_MODELS="openai/gpt-4o-mini,anthropic/claude-3-5-sonnet-20241022" pnpm test:e2e`
  This is useful for quick testing as the full e2e suite can take too long with all models.
  `TEST_MODELS` always overrides provider mappings marked with `test: "skip"`. For example, `TEST_MODELS="anthropic/claude-opus-4-6"` will include that Anthropic mapping even if it is skipped by default, so metadata-driven e2e assertions such as `reasoningOutput` still apply.
- `FULL_MODE` - Include free models in tests (default: only paid models)
- `LOG_MODE` - Enable detailed logging of responses
- `TEST_WEB_SEARCH` - Run `chat-websearch.e2e.ts` (skipped by default). Every case forces a real search, which providers bill per call on top of tokens, so opt in deliberately and scope it with `TEST_MODELS`.

#### Pointing e2e at a proxy or alternate upstream

`beforeAllHook` stamps each provider's `baseUrl` env var (`LLM_OPENAI_BASE_URL`, `LLM_ANTHROPIC_BASE_URL`, …) onto the provider key it seeds, so exporting that var plus the matching `LLM_*_API_KEY` is enough to run the whole suite through a proxy — no test changes needed. An `http://` base URL additionally needs `ALLOW_INSECURE_PROVIDER_URLS=true`.

`chat-service-tier.e2e.ts` cannot pass in that setup: `providerKeyBaseUrlSupportsServiceTier` makes a key with a non-upstream base URL ineligible for Flex/Priority, so every case 400s by design. Exclude that file rather than treating the failures as a regression.

#### E2E Test Structure

Reserve `*.e2e.ts` for tests that make real upstream provider requests. Tests
that use a local or mocked upstream belong in `*.spec.ts` and run with
`pnpm test:unit`, even when they exercise the full gateway request path,
routing, persistence, or streaming.

`pnpm test:e2e` discovers `*.e2e.ts` files sequentially with
`--no-file-parallelism`. Parameterized chat-completion coverage lives in the
`apps/gateway/src/chat-*.e2e.ts` files; those suites use
`getConcurrentTestOptions()` and run their cases concurrently unless
`CONCURRENT_TESTS=false`. Tests that need isolation live in
`apps/gateway/src/api-individual.e2e.ts`.

#### Gateway test harness resets shared state per test

The gateway integration specs use `createGatewayApiTestHarness()` (`apps/gateway/src/test-utils/gateway-api-test-harness.ts`), whose `beforeEach` **deletes and re-seeds all test data before every test** — including the shared organization, which is always re-seeded with `retentionLevel: "retain"`, `plan: "pro"`, and `credits: "100.00"`. Because of this:

- A test may freely mutate shared org/project state (`retentionLevel`, `credits`, `plan`, project `mode`, etc.) **without restoring it afterward** — the next test's `beforeEach` re-seed guarantees isolation. Do not add manual restore/cleanup for these mutations; it is redundant and inconsistent with the rest of the suite.
- A test that depends on a specific value should either rely on the documented seed default (e.g. `retentionLevel: "retain"`) or set it explicitly at the top of the test — never on a value left behind by a previous test.

### Database Operations

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm --filter db push` - Push database schema
- `pnpm --filter db seed` - Seed database with initial data
- `pnpm run setup` – Reset db, sync schema, seed data (use this for development)

## Architecture Overview

**LLM Gateway** is a monorepo containing a full-stack LLM API gateway with multiple services:

### Core Services

- **Gateway** (`apps/gateway`) - LLM request routing and provider management (Hono + Zod + OpenAPI)
- **API** (`apps/api`) - Backend API for user management, billing, analytics (Hono + Zod + OpenAPI)

Production domain mapping (counterintuitive — do not mix these up): `api.llmgateway.io` serves `apps/gateway` (the LLM gateway, :4001 in dev), and `internal.llmgateway.io` serves `apps/api` (the backend API, :4002 in dev).

- **UI** (`apps/ui`) - Frontend dashboard (Next.js App Router)
- **Playground** (`apps/playground`) - Interactive LLM testing environment (Next.js App Router)
- **Code** (`apps/code`) - Dev plans + coding tools landing & dashboard (Next.js App Router)
- **Docs** (`apps/docs`) - Documentation site (Next.js + Fumadocs)

### Shared Packages

- **@llmgateway/db** - Database schema, migrations, and utilities (Drizzle ORM)
- **@llmgateway/models** - LLM provider definitions and model configurations
- **@llmgateway/auth** - Authentication utilities and session management

## Technology Stack

### Backend

- **Framework**: Hono (lightweight web framework)
- **Database**: PostgreSQL with Drizzle ORM
- **Caching**: Redis
- **Authentication**: Better Auth with passkey support
- **Validation**: Zod schemas
- **API Documentation**: OpenAPI/Swagger

### Frontend

- **Framework**: Next.js App Router (React Server Components)
- **State Management**: TanStack Query
- **UI Components**: Radix UI with Tailwind CSS
- **Build Tool**: Next.js (Turbopack during dev; Node/Edge runtime)
- **Navigation**: Use `next/link` for links and `next/navigation`'s router for programmatic navigation

### Development Tools

- **Monorepo**: Turbo with pnpm workspaces
- **TypeScript**: Strict mode enabled
- **Testing**: Vitest for unit and E2E tests
- **Linting**: ESLint with custom configuration
- **Formatting**: Prettier

## Development Guidelines

### Database Operations

- Use the local `migrations` skill for database migration generation, review, edits, and merge conflicts.
- Use Drizzle ORM with latest object syntax
- The schema uses camelCase in TypeScript but the actual database columns are snake_case (configured via Drizzle's `casing: "snake_case"`). When writing raw SQL, always use snake_case column names (e.g. `user_id`, not `userId`).
- For reads: Use `db().query.<table>.findMany()` or `db().query.<table>.findFirst()`
- **For usage/analytics reads, ALWAYS query the aggregation tables, never the `log` table.** `log` is a high-volume, per-request table that also gets pruned by data retention, so scanning it for counts, costs, or "who used X" questions is slow and gives wrong answers for organizations with retention disabled. Use the hourly aggregation tables instead — `project_hourly_stats` (per project/hour totals), `project_hourly_model_stats` (adds `used_model` / `used_provider`), `project_hourly_source_stats` (adds `source`), `api_key_hourly_stats` and `api_key_hourly_model_stats` (per API key), `global_model_stats` and `global_source_stats` (cross-tenant rollups). Join up to `project` → `organization` when you need org-level fields such as `billing_email`. Only fall back to querying `log` when the data genuinely does not exist in any aggregation table (e.g. per-request payloads, `request_id` lookups, individual finish reasons), and say why when you do.
- **NEVER query the `log` table from the gateway request path — no exceptions.** The gateway is latency-critical and extremely high-throughput; a per-request Postgres read against a per-request-volume table is unacceptable there no matter how narrow the predicate, how good the (partial) index, or how short the cache TTL in front of it. This holds for every hot-path signal: credit gates, spend/limit checks, routing. Derive such signals from Redis counters maintained on the write path (e.g. incremented at `insertLog`, settled by the billing worker) or from small already-cached rows — never by aggregating `log` at request time. Dashboards and API routes must not scan `log` either; use the aggregation tables above.
- For schema changes: edit `packages/db/src/schema.ts`, then generate migration artifacts with `pnpm migrations`
- If generated migration SQL needs adaptation, edit only the generated `.sql` file. Never manually edit snapshot JSON or journal files.
- Always sync schema with `pnpm run setup` after table/column changes when local database state needs to be refreshed
- Never write migrations manually from scratch
- **NEVER resolve merge conflicts in migration files, journal files, or snapshot files manually.** When merging with main and migration conflicts occur, ALWAYS follow this exact procedure:
  1. **Before merging**, reset migrations: `git restore --source=origin/main packages/db/migrations/`
  2. **After merging**, regenerate migrations: `pnpm migrations`
  3. Do NOT attempt to manually edit or resolve conflicts in any file under `packages/db/migrations/`

### Creating New Packages

When creating a new package in `packages/`, include these config files. Copy them from an existing package (e.g., `packages/models`) to ensure consistency:

- `package.json` - Package configuration with build scripts
- `tsconfig.json` - TypeScript configuration extending root
- `.prettierignore` - Copy from existing package (ignores `dist` build output)
- `.lintstagedrc.json` - Copy from existing package (lint-staged configuration)
- `eslint.config.mjs` - Copy from existing package (ESLint configuration)

### Code Standards

- Always use the internal api (`apps/api/`) for any backend operations, never use NextJS API routes.
- In frontend apps (`apps/ui`, `apps/playground`, `apps/code`, `ee/admin`), always use the generated typed API client (`useFetchClient()` or `useApi()` from `@/lib/fetch-client`) to call the Hono API. Never use raw `fetch()` for API calls. The client is auto-generated from the OpenAPI spec (`pnpm --filter api generate && pnpm --filter <app> generate`). For non-hook contexts (e.g., utility functions), accept the fetch client as a parameter from the calling component.
- Do not use useEffect for data fetching in the UI; instead, use TanStack Query for all data fetching and state management.
- In frontend apps, always prefer Next.js `<Link>` (`next/link`) over raw `<a>` tags for internal navigation, and `next/navigation`'s router for programmatic navigation.
- Always use top-level `import`, never use require or dynamic imports
- Use conventional commit message format and limit the commit message title to max 50 characters
- NEVER put internal or private information into anything published to the public repository — commit titles and bodies, branch names, PR titles and descriptions, PR/issue comments, code comments, changelog entries, or docs. This repository is public. Specifically never include: real user or customer names, email addresses, customer/partner/company names, organization/project/user IDs, API keys, tokens, secrets or credentials (including partial or redacted-looking values), dollar amounts (revenue, credit balances, spend, invoice totals, contract values), internal dashboards, internal ticket/Slack/Linear links, or internal infrastructure hostnames. Describe the situation generically instead — "a customer organization", "an enterprise account", "a large credit balance", "the affected provider key". Seeded test fixtures that already live in the repo (`admin@example.com`, `test-token`, `Test Organization`) and public provider pricing from `packages/models` are fine
- Do not --amend commits after pushing to remote
- Never force push on main/default branch; force pushing is only acceptable on feature branches
- When checking out an existing PR or remote branch, always set its upstream (`git checkout -B <branch> FETCH_HEAD && git branch --set-upstream-to=origin/<branch>`, or `gh pr checkout <n>`) so plain `git pull` and `git push` work afterwards
- When syncing a feature branch with main, default to a merge commit; only rebase when it is required or clearly the better choice, and say why
- When resolving conflicts involving `pnpm-lock.yaml`, just run `pnpm install` to automatically resolve them
- Use the local `pull-request` skill for opening pull requests, writing/updating PR titles and descriptions, embedding screenshots in a PR body, and triggering e2e CI on a PR.
- When a change splits into layers that are worth reviewing separately (e.g. a UI feature plus the new permission it needs), use GitHub's **native stacked pull requests** via the `gh stack` extension — never hand-roll a stack by pointing one PR's base at another branch. `gh stack init <bottom> <top>` adopts existing branches, `gh stack submit` creates/links the PRs, `gh stack rebase && gh stack push` restacks onto main, and `gh stack merge` lands the stack. GitHub rebases and retargets the layers above automatically as each one merges, which is what keeps a squash-merge repo like this one from conflicting
- When writing pull request titles, use the conventional commit message format and limit to max 50 characters
- Always open pull requests as normal ready-for-review PRs, not draft PRs, unless the user explicitly asks for a draft PR
- When creating a pull request, always write/update both the PR title and description; if the PR's scope changes in later commits, update the title and description to reflect the final scope before handing it off
- Screenshots in a PR description are ONLY for changes to the three dashboard UIs: the main UI (`apps/ui`), the DevPass UI (`apps/code`), and the admin UI (`ee/admin`). For those, always embed screenshots of the affected screens — run the app locally, capture the new/changed state, and use the `pull-request` skill's screenshot workflow to attach them. For changes to an existing screen, show a before/after pair; for anything with light and dark styling, include both themes
- NEVER screenshot `apps/docs`, and do not screenshot content-only changes elsewhere (marketing copy, changelog entries, MDX prose). Prose in a docs page always renders fine, so the screenshot proves nothing and just costs a local server run — link the changed file instead
- Always use pnpm for package management
- Use cookies for user-settings which are not saved in the database to ensure SSR works
- Apply DRY principles for code reuse
- Do not add explicit caching or memoization around `process.env` reads or parsed env-var values unless there is a measured hot-path need
- Exception: in `packages/models`, explicit duplication of model/provider mappings is acceptable and preferred over helper-based expansion. This is the only place in the repo where duplicating model definitions is OK. NEVER add helper functions (e.g. `makeModel(...)`/`makeProvider(...)`) that build model or provider definition objects, even when it means repeating fields across entries — write each model and provider mapping out in full as a plain object literal in the `models` array. Small shared `const` values are fine, but the definition objects themselves must not be constructed by a function.
- Models and provider mappings already present on `origin/main` can NEVER be removed, only deactivated. To retire one, set `deactivatedAt: new Date("YYYY-MM-DD")` on the relevant provider mapping(s) instead of deleting the definition. Use the actual retirement date when known, including retroactively; otherwise use today's date. Historical usage records and analytics reference these definitions, so deleting them breaks lookups. New definitions added only on the current unmerged branch may be removed normally.
- In `packages/models`, ALWAYS express per-token prices (`inputPrice`, `outputPrice`, `cachedInputPrice`, and any other per-token price field) using `e-6` notation so the coefficient reads directly as USD per million tokens (e.g. `"1.4e-6"` for $1.40/M — the exact number providers publish). Never use `e-3` or other exponents for per-token prices. This does NOT apply to `requestPrice`, which is a flat USD amount charged per request (e.g. `"0.035"`), nor to `perSecondPrice`.
- In `packages/models`, never add comments that only cite a source or restate a value — e.g. "taken from provider X's pricing page", "// Ref: https://…", "verified live on <date>", or `webSearchPrice: "0.01", // $0.01 per search`. They add nothing the field does not already say, and they rot as soon as the catalogue changes. Comments explaining WHY a field is set to a non-obvious value ARE valuable and must be kept and maintained: why a capability flag is `false` or restricted (`jsonOutput: false`, `supportedToolChoices`, a trimmed `reasoningEfforts` list), why a mapping is `stability: "unstable"` / `test: "skip"` / `deactivatedAt`, or any deployment quirk that a future reader would otherwise "fix" by reverting.
- In `packages/models`, a single model definition must never contain two provider mappings with the same `providerId` (regional variants belong in that mapping's `regions` array instead). Mapping lookup keys on `(providerId, region)` throughout the gateway — `selectProviderMapping`, `costs.ts`, `prepare-request-body.ts` — so a second same-provider mapping is unaddressable: it silently resolves back to the first one, meaning requests get validated and **billed** at the wrong mapping's prices, and e2e generates two identically-named test cases that both exercise only the first. A distinct upstream deployment (e.g. a provider's "fast"/priority router with its own `externalId` and pricing) needs its own canonical model entry with its own `id`.
- No unnecessary code comments
- Organizations backing LLM SDK end-user wallets are always regular PAYG (credits) organizations — never `devpass` or `chat` plan orgs. Gateway logic gated on the org's `kind`/plan (e.g. dev-plan model restrictions or the dev-plan default service tier) therefore never needs to account for the end-user-wallet credits substitution (`withWalletCredits`); that substitution only affects downstream credit gating.
- `organization.kind` (`default` / `devpass` / `chat`) is **immutable**: it is assigned when the organization is created and there is no code path — API route, admin action or migration — that changes it afterwards. An org never migrates between kinds; a user who signs up for DevPass or Chat gets a separate organization (see `apps/api/src/utils/personal-org.ts`). Treat it as a fixed attribute: it is safe to join to it when attributing historical data, and analytics keyed on it never need a slowly-changing-dimension snapshot. `organization.plan` is the opposite — it does change over time, so never treat the two the same way.
- The Pro plan can only ever be booked on a `default` organization. DevPass and Chat orgs have no plan concept at all: their entitlement lives entirely in `devPlan` / `chatPlan` and the matching `*CreditsLimit` / `*StripeSubscriptionId` columns, and `organization.stripeSubscriptionId` is reserved for a team org's Pro subscription. Every Stripe webhook that sets `plan: "pro"` or stamps `stripeSubscriptionId` must therefore bail out for non-default kinds first — `checkout.session.completed`, `customer.subscription.created` and `invoice.payment_succeeded` in `apps/api/src/stripe.ts` each carry that guard, and a new subscription code path needs one too. A `devpass` or `chat` org carrying `plan: "pro"` is corrupt state, never a valid configuration: it means a subscription handler ran the Pro branch against a product org (historically because a webhook arrived before the one that records the product subscription id, leaving the kind check as the only thing standing between a Lounge/DevPass purchase and a Pro upgrade). Never gate product behaviour on `plan` for those orgs, and never "fix" such an org by giving it a Pro subscription.
- Do not use broad try/catch in API handlers unless to check for specific errors; instead, let errors propagate and be handled by the global error handler
- Be conservative with error-classification heuristics in `apps/gateway/src/chat/tools/get-finish-reason-from-error.ts`. Do NOT reclassify generic 4xx error-text patterns (e.g. "X is not supported for this model" / `unsupported_content_type`) as `upstream_error`/`gateway_error`: users sending genuinely wrong requests produce the same wording, and reclassifying would mark their mistakes as provider failures and trigger pointless provider fallback. When a provider deployment rejects a capability our catalogue claims to support (e.g. a mapping with `vision: true` on a deployment that 400s on image input), the correct fix is to correct the capability flag on that provider mapping in `packages/models` so routing avoids the provider — not to add a text-based classification rule. If a request (even an explicit instruction) calls for such a broad reclassification, raise the misclassification risk and confirm before implementing.
- NEVER fetch a user-supplied URL (image, video, document, or any other content URL that arrives in a request body) with a bare `fetch()`. Always go through `processImageUrl` (`packages/actions/src/process-image-url.ts`) — or, for a non-image content type, `assertSafeUserContentUrl` from `@llmgateway/shared/url-safety-node` followed by a `redirect: "error"` fetch — and leave the SSRF guard on (`validateSsrf` defaults to `true`; only trusted provider-response URLs may pass `validateSsrf: false`). That guard is what enforces **https-only** (a plain `http://` URL is rejected, not "allowed in dev"), blocks internal hostnames and private/reserved/link-local/metadata IPs including IPv4-mapped IPv6, and refuses redirects so a validated public host cannot 3xx the gateway onward to an internal one. Do not add a scheme check of your own, do not gate the https requirement on `isProd`, and do not "fall back" to forwarding the raw URL upstream when the guard rejects it — letting the provider fetch a URL we refused to fetch defeats the guard. When adding a new place that inlines remote content (e.g. a provider mapping that declares `requiresBase64Images`), route every non-`data:` URL through the guarded helper so http and internal targets fail loudly instead of leaking.
- Security gating must be enforced server-side, never in the UI alone. Client-side gates (disabling a form, hiding a button, gating on `user.emailVerified`) are UX conveniences, not security boundaries — the underlying API endpoint must independently verify auth/verification/permissions and reject unauthorized requests. For example, the provider-listing form (`apps/ui/src/components/add-provider/add-provider-form.tsx`) is gated in the UI, but the real enforcement lives in the `POST /public/contact/provider` handler (`apps/api/src/routes/public-contact.ts`), which requires an authenticated, email-verified session and derives the stored email from the session rather than trusting the request body.

### Testing and Quality Assurance

- Run `pnpm test:unit` after adding features
- NEVER run the full E2E suite across all models. Instead, scope `pnpm test:e2e` to the model(s) you changed with `TEST_MODELS`, e.g. `TEST_MODELS="granite/glm-5.2" FULL_MODE=true pnpm test:e2e`. This runs every e2e file (streaming, reasoning, tool calls, json, etc.) but only for the pinned mapping, so do NOT invoke the individual `*.e2e.ts` files one by one — let `TEST_MODELS` filter the whole suite in a single run.
- Run `pnpm build` to ensure production builds work
- Run `pnpm format` after code changes
- The CI e2e workflow (`.github/workflows/e2e.yml`) does NOT run automatically on pull requests, because e2e runs spend real money on provider API calls. Trigger it on demand by commenting `/e2e` on the pull request (only for maintainers/collaborators, and only for branches in this repository, not forks), or via `workflow_dispatch`.

### Service URLs (Development)

- UI: http://localhost:3002
- Playground: http://localhost:3003
- Code: http://localhost:3004
- API: http://localhost:4002
- Gateway: http://localhost:4001
- Docs: http://localhost:3005
- Admin: http://localhost:3006
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- Storage Redis: localhost:6479 (only used when a `STORAGE_REDIS_*` var is set; otherwise the main Redis connection is reused)

## Folder Structure

- `apps/ui`: Next.js frontend
- `apps/playground`: Interactive LLM testing environment
- `apps/code`: Dev plans + coding tools landing & dashboard
- `apps/api`: Hono backend
- `apps/gateway`: API gateway for routing LLM requests
- `apps/docs`: Documentation site
- `ee/admin`: Internal Admin Dashboard (Enterprise License)
- `packages/db`: Drizzle ORM schema and migrations
- `packages/models`: Model and provider definitions
- `packages/shared`: Shared types and utilities

## Key Features

### LLM Gateway

- Multi-provider support (OpenAI, Anthropic, Google Vertex AI, etc.)
- OpenAI-compatible API interface
- Request routing and load balancing
- Response caching with Redis
- Usage tracking and cost analytics

### Management Platform

- User authentication with passkey support
- API key management
- Project and organization management
- Billing integration with Stripe
- Real-time usage monitoring
- Provider key management

### Database Schema

- Users, organizations, and projects
- API keys and provider configurations
- Usage tracking and billing records
- Analytics and performance metrics

## License

LLM Gateway is available under a dual license:

- **Open Source**: Core functionality is licensed under AGPLv3 - see the [LICENSE](LICENSE) file for details.
- **Enterprise**: Commercial features in the `ee/` directory require an Enterprise license - see [ee/LICENSE](ee/LICENSE) for details.

### Enterprise features include:

- Advanced billing and subscription management
- Extended data retention (90 days vs 3 days)
- Provider API key management
- Team and organization management
- Priority support
- And more to be defined

For enterprise licensing, please contact us at contact@llmgateway.io
