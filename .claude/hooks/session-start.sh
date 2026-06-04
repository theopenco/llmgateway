#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions, never locally.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# 1. Install JS dependencies (fast no-op when already installed).
pnpm install

# 2. The web container boots without the Docker daemon running. Start it if
#    needed and wait until it is reachable.
if ! docker info >/dev/null 2>&1; then
	dockerd >/tmp/dockerd.log 2>&1 &
	for _ in $(seq 1 60); do
		docker info >/dev/null 2>&1 && break
		sleep 1
	done
fi

# 3. Build core packages (required for the db seed) and start Postgres + Redis.
pnpm build:core
docker compose up -d

# 4. Wait for Postgres to accept connections.
for _ in $(seq 1 60); do
	docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break
	sleep 1
done

# 5. Sync schema + seed only when the database has not been initialized yet, so
#    resuming an existing session does not wipe in-progress data.
INITIALIZED=$(docker compose exec -T postgres \
	psql -U postgres -d test -tAc \
	"SELECT to_regclass('public.model_provider_mapping') IS NOT NULL" 2>/dev/null || echo "f")

if [ "$INITIALIZED" != "t" ]; then
	pnpm push-test
	pnpm push-dev
	pnpm seed
fi
