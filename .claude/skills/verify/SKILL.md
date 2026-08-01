---
name: verify
description: Build, launch, and drive the LLM Gateway stack locally to verify a change end-to-end (API + DevPass dashboard + gateway), including Stripe webhook flows.
---

# Verify a change by running the stack

Build first (always via Turbo filters): `pnpm exec turbo run build --filter=api --filter=gateway --filter=code`.

## Launch on offset ports (never fight other worktrees for :4002/:3004)

Each server blocks, so run each one in its own terminal session (or as its own
background task). In every session, set the shared DB/Redis env first:

```bash
# All sessions — persistent containers openllm-pg (5433) and openllm-redis (6380)
export DATABASE_URL="postgres://postgres:pw@localhost:5433/db" REDIS_PORT=6380
```

Terminal 1 — API on :4102 (env vars on the command line beat ../../.env):

```bash
cd apps/api && PORT=4102 API_URL=http://localhost:4102 CODE_URL=http://localhost:3104 \
  ORIGIN_URLS="http://localhost:3104,http://localhost:4102" \
  node --enable-source-maps --env-file=../../.env dist/serve.js
```

Terminal 2 — DevPass dashboard on :3104:

```bash
cd apps/code && API_URL=http://localhost:4102 pnpm exec next dev --port 3104 --turbopack
```

Terminal 3 — Gateway on :4101:

```bash
cd apps/gateway && PORT=4101 node --enable-source-maps --env-file=../../.env dist/serve.js
```

If the DB is empty, seed with `pnpm --filter db seed`. Login: `admin@example.com` /
password same as email (owns DevPass Pro org `test-personal-org-id`, API key
`llmgdev_devpass_test_token`).

## Gotchas

- Session auth via curl: POST `/auth/sign-in/email` with `Origin:` header from
  ORIGIN_URLS, save cookies (`-c cookies.txt`), reuse with `-b`.
- Dev-plan API keys reject `provider/model` ids on the gateway — use the root
  model id (`claude-opus-4-8`, not `anthropic/claude-opus-4-8`).
- Stripe end-to-end: `stripe listen --api-key $STRIPE_SECRET_KEY --print-secret`
  (key from root .env; the CLI's own login is expired), restart the API with
  `STRIPE_WEBHOOK_SECRET_TEST=<whsec>`, then `stripe listen --api-key ... --forward-to
  localhost:4102/stripe/webhook`. Hosted checkout accepts 4242 4242 4242 4242.
  Test idempotency with `stripe events resend <evt_id>`.
- Drive the dashboard with Playwright MCP; screenshots must be saved under the
  repo's `.playwright-mcp/` (its allowed root).
