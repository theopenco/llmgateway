---
name: local-stack
description: Run an isolated per-worktree LLM Gateway stack — own Postgres, Redis, storage Redis, and app ports — and tear it down safely. Use before running unit tests, starting dev servers, reseeding, or running docker compose in a worktree; when choosing STACK_SUFFIX, port slots, or .envrc; when a port is taken, a local server behaves like another worktree's code, or a relocated frontend fails CORS or login.
---

# Local stack per worktree

Several worktrees share this machine, and only one stack can own the default
ports (:4001, :5432, :6379). Before assuming local edits are live, confirm which
tree serves a port: `lsof -a -p <pid> -d cwd -Fn`. Give each worktree its own
stack instead of sharing the defaults.

Every host-facing port and Docker name is env-var driven; the defaults reproduce
the single shared stack.

## Pick a slot

Pick a slot _N_ (1, 2, 3 …) and offset every port:

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
| Airside              | `AIRSIDE_PORT`       | 3007    | 3007 + N × 100  | 3107   |

Redis uses ×1000 so slot 1's Redis does not land on another worktree's default
storage-Redis port (6479).

## Configure `.envrc`

Put the block in the worktree's gitignored `.envrc` (direnv; `direnv allow`
after editing). Exported vars reach `docker compose`, `drizzle-kit`, `vitest`,
and Node, and Node's `--env-file` never overrides an exported var.

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
export AIRSIDE_PORT=3107

# URLs the services hand to each other / render into pages
export API_URL=http://localhost:4102
export UI_URL=http://localhost:3102
export APP_URL=http://localhost:3102
export GATEWAY_URL=http://localhost:4101
export PLAYGROUND_URL=http://localhost:3103
export DOCS_URL=http://localhost:3105
export ADMIN_URL=http://localhost:3106
export AIRSIDE_URL=http://localhost:3107
export ORIGIN_URLS=http://localhost:3102,http://localhost:3103,http://localhost:3104,http://localhost:3105,http://localhost:3106,http://localhost:3107,http://localhost:4102
```

Agent shells do not run direnv. Prefix every command that depends on the block
with `set -a && source .envrc && set +a`.

## Start

```bash
docker compose up -d          # project llmgateway-tel-aviv, containers postgres-tel-aviv, …
pnpm wait-for-services
pnpm push-test
pnpm push-dev
pnpm seed
```

`pnpm setup` does all of this after a `down -v`; run it only with
`STACK_SUFFIX` set.

Turbo's strict env mode drops the undeclared port and `DATABASE_URL` vars, so
start dev servers with `pnpm exec turbo run dev --env-mode=loose` and confirm
the startup logs show your ports. To relocate one service, run it directly:

```bash
( cd apps/api && API_PORT=4102 API_URL=http://localhost:4102 UI_URL=http://localhost:3102 \
    ORIGIN_URLS=http://localhost:3102,http://localhost:4102 \
    node --enable-source-maps --env-file=../../.env dist/serve.js )   # build first: turbo run build --filter=api
```

`dist/serve.js` has no watch; rebuild and restart after changes. The worker runs
`dist/index.js`. Stop servers by PID (`lsof -nP -iTCP:<port> -sTCP:LISTEN`); a
`pkill -f` pattern also kills other worktrees' servers.

## How the wiring works

- **Docker**: `docker-compose.yml` derives the project name (`llmgateway${STACK_SUFFIX}`) and each `container_name` from `STACK_SUFFIX`, so `down -v` and `pnpm setup` touch only your project. Address containers with `docker compose exec postgres …`, not `docker exec postgres …`.
- **Databases**: apps read `DATABASE_URL`; tests read `TEST_DATABASE_URL`, falling back to `DATABASE_URL`, then `postgres://postgres:pw@localhost:5432/test`. Set both: `TEST_DATABASE_URL` keeps `pnpm test:unit` off the dev database, and `pnpm push-test` pushes to it.
- **Redis**: `packages/cache` reads `REDIS_HOST`/`REDIS_PORT` and `STORAGE_REDIS_HOST`/`STORAGE_REDIS_PORT`. Any `STORAGE_REDIS_*` var enables the separate storage instance, so always set `STORAGE_REDIS_PORT`.
- **Service ports**: gateway and api fall back to `PORT`; use `GATEWAY_PORT` and `API_PORT` instead and leave `PORT` unset. A second gateway needs `METRICS_PORT`. The Next.js `dev` scripts read `UI_PORT`/`PLAYGROUND_PORT`/`CODE_PORT`/`DOCS_PORT`/`ADMIN_PORT`.
- **Auth + CORS**: the API reads `ORIGIN_URLS` (CORS and better-auth trusted origins) and `UI_URL`. Add every relocated frontend's origin to `ORIGIN_URLS`. The session cookie is host-only for `localhost`, so login works across ports.
- **Frontends → backends**: frontends read `API_URL` and `GATEWAY_URL` server-side in `apps/*/src/lib/config-server.ts`.

## Tear down

Tear down a stack you started in this session once the work is finished:

```bash
set -a && source .envrc && set +a
echo "llmgateway${STACK_SUFFIX}"   # must print your project, not plain "llmgateway"
docker compose down -v
```

Leave the default shared stack (no `STACK_SUFFIX`) and any stack you did not
start running: it is the user's development database, and `-v` destroys its
volumes.
