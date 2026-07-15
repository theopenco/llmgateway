# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Development Commands

### Setup and Dependencies

- `pnpm install` - Install all dependencies
- `pnpm setup` - Full development environment setup (starts Docker, syncs DB, seeds data)
- `docker compose up -d` - Start PostgreSQL and Redis services

### Development

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

- `pnpm dev` - Start all development servers (UI on :3002, Playground on :3003, Code on :3004, API on :4002, Gateway on :4001, Docs on :3005, Admin on :3006)
- `pnpm build` - Build all applications for production. ALWAYS run this after finishing work on a feature. ALWAYS run a full build to make sure things fork.
- `pnpm clean` - Clean build artifacts and cache directories

To build a single app, ALWAYS use a Turbo filter (`turbo run build --filter=<app>`), e.g. `turbo run build --filter=gateway`. NEVER use `pnpm --filter <app> build` for builds: that runs the app's `tsc` directly without rebuilding workspace dependency packages first, so it compiles against stale `dist/` artifacts and produces spurious errors (missing `@llmgateway/*` modules, "value not in type union", etc.). Turbo's `build` depends on `^build`, so a Turbo filter builds the dependency packages in topological order first.

Note: `apps/api` and `apps/gateway` build with plain `tsc` (`tsc && resolve-tspaths`) and run `node dist/serve.js` — there is no bundler. Bundler concepts like "mark a dependency as external" do not apply to these apps; runtime dependencies are ordinary `node_modules` imports. Only the Next.js frontends have a bundler.

### Code Quality

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

ALWAYS run `pnpm format` before committing code. Run `pnpm build` if API routes were modified.

- `pnpm format` - Format code and fix linting issues. ALWAYS run this before committing code.
- `pnpm lint` - Check linting and formatting (without fixing)

### Writing code

This is a pure TypeScript project. Never use `any` or `as any` unless absolutely necessary.
This repository always uses tabs for indentation.

When you are done writing code features or bug fixes, ALWAYS commit your changes. If in doubt, commit any changes.

### Documentation

- NEVER hardcode a list of models, providers, provider countries/headquarters, or any other catalogue-derived enumeration into documentation (`apps/docs`), changelog entries, or marketing copy. These lists go stale the moment the catalogue changes and are annoying to keep in sync. Instead, link to the relevant live page that is generated from the catalogue (e.g. the [models page](https://llmgateway.io/models) or [providers page](https://llmgateway.io/providers)).
- The ONLY exception is video generation and image generation models: their per-model requirements (supported sizes, durations, resolutions, etc.) are how users figure out how to call them, so listing those specific models and their constraints in the docs is acceptable and preferred there.

### Testing

NOTE: these commands can only be run in the root directory of the repository, not in individual app directories.

Do not run test files or suites in parallel unless the repository instructions for that exact suite explicitly require it. Some gateway and worker tests share ports, databases, and process state, so parallel test runs can produce false failures.

- `pnpm test:unit` - Run unit tests (\*.spec.ts files)
- `pnpm test:e2e` - Run end-to-end tests (\*.e2e.ts files)

When running curl commands against the local API, you can use `test-token` as authentication.

Every seeded account's password is its own email address (password == email). For example, log into the dashboard as `admin@example.com` with the password `admin@example.com`. This applies to all users created by `packages/db/src/seed.ts`, including:

- `admin@example.com` — default test admin (owns "Test Organization" + a DevPass Pro workspace)
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

Caveat: if you run multiple git worktrees (e.g. conductor workspaces), only one `pnpm dev` can own port :4001 — confirm which working tree is actually serving it (`lsof -a -p <pid> -d cwd -Fn`) before assuming your local edits are live, or launch your own build on a different `PORT`.

#### Running the dev stack on alternate ports (avoiding worktree conflicts)

When another worktree already owns the default ports, run your stack on an offset range instead of fighting for :4002/:3002/etc. The wiring is driven entirely by env vars — no code changes needed:

- **API port**: `PORT` (default `4002`). The API's own base URL is `API_URL`.
- **Frontends → API**: every frontend resolves the backend from `API_URL` (default `http://localhost:4002`), read server-side in `apps/*/src/lib/config-server.ts`. Set it to your relocated API for each frontend process.
- **Auth + CORS**: the API reads `ORIGIN_URLS` (comma-separated CORS/better-auth trusted-origins allowlist; defaults to `localhost:3002..3006,4002`) and `UI_URL`. If you relocate a frontend you MUST add its new origin to `ORIGIN_URLS` or login/API calls fail CORS. Login itself works across ports because the better-auth session cookie is host-only for `localhost` (shared across all ports) — no `COOKIE_DOMAIN` change needed.

Two gotchas:

- The `ui`/`playground`/`code` `dev` scripts hard-code `--port` in `package.json`, so overriding `PORT` alone won't move them — run `next dev --port <n>` directly.
- The API `dev` script loads `../../.env` via `node --env-file`; Node does NOT override already-exported process env, so vars you `export`/prefix on the command line win over `.env`.

Example: API on :4102, UI on :3102, Playground on :3103 (run from repo root, backgrounded):

```bash
ORIGINS="http://localhost:3102,http://localhost:3103,http://localhost:4102"
( cd apps/api && PORT=4102 API_URL=http://localhost:4102 UI_URL=http://localhost:3102 ORIGIN_URLS="$ORIGINS" \
    node --enable-source-maps --env-file=../../.env dist/serve.js )        # build first: turbo run build --filter=api
( cd apps/ui         && API_URL=http://localhost:4102 pnpm exec next dev --port 3102 --turbopack )
( cd apps/playground && API_URL=http://localhost:4102 pnpm exec next dev --port 3103 --turbopack )
```

Running the built `dist/serve.js` gives no watch (rebuild + restart the API after code changes); swap in the `api` package's `dev` script if you want tsc-watch. All apps share the one Postgres/Redis on the default ports, so the relocated stack sees the same seeded DB.

#### E2E Test Options

- `TEST_MODELS` - Run tests only for specific models (comma-separated list of `provider/model-id` pairs)
  Example: `TEST_MODELS="openai/gpt-4o-mini,anthropic/claude-3-5-sonnet-20241022" pnpm test:e2e`
  This is useful for quick testing as the full e2e suite can take too long with all models.
  `TEST_MODELS` always overrides provider mappings marked with `test: "skip"`. For example, `TEST_MODELS="anthropic/claude-opus-4-6"` will include that Anthropic mapping even if it is skipped by default, so metadata-driven e2e assertions such as `reasoningOutput` still apply.
- `FULL_MODE` - Include free models in tests (default: only paid models)
- `LOG_MODE` - Enable detailed logging of responses

#### E2E Test Structure

E2E tests are organized for optimal performance:

- **Parallel execution**: Tests run up to 16 in parallel using Vitest's thread pool (minimum 8 threads)
- **Split structure**:
  - `apps/gateway/src/api.e2e.ts` - Contains all `.each()` tests that benefit from parallelization
  - `apps/gateway/src/api-individual.e2e.ts` - Contains individual test cases that need isolation
- **Concurrent mode**: The main test suite uses `{ concurrent: true }` to enable parallel execution of `.each()` tests

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
- Do not --amend commits after pushing to remote
- Never force push on main/default branch; force pushing is only acceptable on feature branches
- When resolving conflicts involving `pnpm-lock.yaml`, just run `pnpm install` to automatically resolve them
- When writing pull request titles, use the conventional commit message format and limit to max 50 characters
- Always open pull requests as normal ready-for-review PRs, not draft PRs, unless the user explicitly asks for a draft PR
- When creating a pull request, always write/update both the PR title and description; if the PR's scope changes in later commits, update the title and description to reflect the final scope before handing it off
- Always use pnpm for package management
- Use cookies for user-settings which are not saved in the database to ensure SSR works
- Apply DRY principles for code reuse
- Do not add explicit caching or memoization around `process.env` reads or parsed env-var values unless there is a measured hot-path need
- Exception: in `packages/models`, explicit duplication of model/provider mappings is acceptable and preferred over helper-based expansion. This is the only place in the repo where duplicating model definitions is OK. NEVER add helper functions (e.g. `makeModel(...)`/`makeProvider(...)`) that build model or provider definition objects, even when it means repeating fields across entries — write each model and provider mapping out in full as a plain object literal in the `models` array. Small shared `const` values are fine, but the definition objects themselves must not be constructed by a function.
- Models and provider mappings in `packages/models` can NEVER be removed, only deactivated. To retire a model or provider mapping, set `deactivatedAt: new Date("YYYY-MM-DD")` (today's date) on the relevant provider mapping(s) instead of deleting the definition. Historical usage records and analytics reference these definitions, so deleting them breaks lookups.
- In `packages/models`, ALWAYS express per-token prices (`inputPrice`, `outputPrice`, `cachedInputPrice`, and any other per-token price field) using `e-6` notation so the coefficient reads directly as USD per million tokens (e.g. `"1.4e-6"` for $1.40/M — the exact number providers publish). Never use `e-3` or other exponents for per-token prices. This does NOT apply to `requestPrice`, which is a flat USD amount charged per request (e.g. `"0.035"`), nor to `perSecondPrice`.
- No unnecessary code comments
- Do not use broad try/catch in API handlers unless to check for specific errors; instead, let errors propagate and be handled by the global error handler
- Security gating must be enforced server-side, never in the UI alone. Client-side gates (disabling a form, hiding a button, gating on `user.emailVerified`) are UX conveniences, not security boundaries — the underlying API endpoint must independently verify auth/verification/permissions and reject unauthorized requests. For example, the provider-listing form (`apps/ui/src/components/add-provider/add-provider-form.tsx`) is gated in the UI, but the real enforcement lives in the `POST /public/contact/provider` handler (`apps/api/src/routes/public-contact.ts`), which requires an authenticated, email-verified session and derives the stored email from the session rather than trusting the request body.

### Testing and Quality Assurance

- Run `pnpm test:unit` after adding features
- NEVER run the full E2E suite across all models. Instead, scope `pnpm test:e2e` to the model(s) you changed with `TEST_MODELS`, e.g. `TEST_MODELS="granite/glm-5.2" FULL_MODE=true pnpm test:e2e`. This runs every e2e file (streaming, reasoning, tool calls, json, etc.) but only for the pinned mapping, so do NOT invoke the individual `*.e2e.ts` files one by one — let `TEST_MODELS` filter the whole suite in a single run.
- Run `pnpm build` to ensure production builds work
- Run `pnpm format` after code changes

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
