---
name: testing
description: Run, write, and debug LLM Gateway unit and e2e tests — pnpm test:unit, pnpm test:e2e, TEST_MODELS scoping, the gateway test harness, seeded accounts and test tokens, pinning a provider with x-no-fallback, e2e proxies, and test fixtures or cleanup. Use when running or adding *.spec.ts or *.e2e.ts files, reproducing a provider failure locally, triggering CI e2e, or when tests fail only locally or intermittently.
---

# Testing

Run commands from the repository root.

- `pnpm test:unit` runs `*.spec.ts` files in parallel; each vitest worker gets its own database clone and Redis logical database (`REDIS_DB`). Every new ioredis client takes `db: Number(process.env.REDIS_DB) || 0`.
- `pnpm test:e2e` runs `*.e2e.ts` files sequentially.
- Run separate suites and e2e files one at a time: they share ports, databases, and process state.

## Isolated database first

Use the `local-stack` skill to give the worktree its own stack, then:

```bash
docker compose up -d && pnpm wait-for-services && pnpm push-test
TEST_DATABASE_URL=… pnpm test:unit
```

A run against the shared stack races other worktrees' schema pushes and seeds.

## Local credentials

- `test-token` authenticates against the local API and gateway. `test-token-no-retention` belongs to a seeded org with `retentionLevel: "none"`.
- Seeded users log in with their email as password, e.g. `admin@example.com` / `admin@example.com`. Accounts come from `packages/db/src/seed.ts`: `admin@example.com` (owns "Test Organization", "Test No Retention Organization", and a DevPass Pro workspace), `enterprise@example.com`, `developer@example.com` (project-scoped RBAC), and bulk demo users.

## Reproduce a provider failure

Pin the provider and disable fallback, or a healthy provider masks the error:

```bash
curl -N http://localhost:4001/v1/chat/completions \
  -H "Authorization: Bearer test-token" -H "x-no-fallback: true" \
  -d '{"model":"embercloud/minimax-m2.5","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

The gateway caches responses, errors included, keyed on the request body; vary
the prompt when retesting.

## E2E

`*.e2e.ts` is only for tests that call real upstream providers. Tests with a
local or mocked upstream are `*.spec.ts`, even across the full gateway path.
Parameterized chat coverage lives in `apps/gateway/src/chat-*.e2e.ts` (cases run
concurrently unless `CONCURRENT_TESTS=false`); isolated tests in
`apps/gateway/src/api-individual.e2e.ts`.

Options:

- `TEST_MODELS` — comma-separated `provider/model-id` list; overrides `test: "skip"`, so metadata-driven assertions still apply.
- `FULL_MODE` — include free models and per-effort cases.
- `LOG_MODE` — log responses.
- `TEST_WEB_SEARCH` — run `chat-websearch.e2e.ts`; each case bills a real search, so scope it with `TEST_MODELS`.

For mapping-only changes, the only relevant result is a run scoped to those
mappings (`TEST_MODELS="alibaba/glm-5.2" FULL_MODE=true pnpm test:e2e`). Run the
whole command, not individual `*.e2e.ts` files, and add only mappings whose run
is fully green after the last fix. Failures outside the selected mappings do not
affect acceptance.

To run through a proxy, export the provider's base-URL var (`LLM_OPENAI_BASE_URL`,
…) with its `LLM_*_API_KEY`; `beforeAllHook` stamps it onto the seeded provider
key. An `http://` base URL also needs `ALLOW_INSECURE_PROVIDER_URLS=true`.

CI e2e (`.github/workflows/e2e.yml`) spends real money and runs on demand only:
comment `/e2e` on a same-repo PR (maintainers) or use `workflow_dispatch`. Push
first: `/e2e` refuses a head pushed after the comment. Use it
for complex gateway or backend changes affecting routing, stability, uptime, or
provider integration.

## Writing tests

- `createGatewayApiTestHarness()` (`apps/gateway/src/test-utils/gateway-api-test-harness.ts`) deletes and re-seeds all data before every test; the shared org is `retentionLevel: "retain"`, `plan: "pro"`, `credits: "100.00"`. Mutate shared state freely without restoring it, and set any value a test depends on explicitly or rely on those defaults.
- Gateway unit tests load the root `.env`, which holds real provider keys. A test that needs a provider without credentials saves and deletes `LLM_<PROVIDER>_API_KEY` (and `_BASE_URL`), restoring them in `finally`.
- Build credential-shaped fixtures at runtime (`["sk", "live", "..."].join("_")`) so push protection accepts the branch. Assert on booleans, never equality with a credential: CI test artifacts are public and unmasked.
- Delete cascade-linked tables sequentially, children before parents. `deleteAll()` keeps the catalogue tables, so a spec that seeds `model`/`model_provider_mapping` rows removes them itself, with ids distinct from the real catalogue.
- Keep logs and scratch files under `.context/`; `/tmp` is shared with other agents.
