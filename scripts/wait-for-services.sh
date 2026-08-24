#!/usr/bin/env bash
# Wait until the local dev services (Postgres + Redis) are ready to accept work.
#
# `docker compose up -d` returns as soon as the containers are *created*, which
# is well before Postgres has finished initdb and run packages/db/init/init.sql,
# so `pnpm push-test` / `pnpm push-dev` / `pnpm seed` used to race against it.
#
# Honours the same per-worktree env vars as docker-compose.yml (STACK_SUFFIX,
# POSTGRES_PORT, REDIS_PORT, STORAGE_REDIS_PORT), so an isolated stack waits for
# its own containers. Tunables:
#   WAIT_TIMEOUT   total seconds to wait  (default 180)
#   WAIT_INTERVAL  seconds between tries  (default 2)
set -uo pipefail

TIMEOUT="${WAIT_TIMEOUT:-180}"
INTERVAL="${WAIT_INTERVAL:-2}"

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
STORAGE_REDIS_PORT="${STORAGE_REDIS_PORT:-6479}"

cd "$(dirname "$0")/.." || exit 1

# True when the compose service has a container in this project (i.e. we can
# probe it directly instead of only poking at the published port).
has_container() {
	[ -n "$(docker compose ps -q "$1" 2>/dev/null)" ]
}

tcp_open() {
	(exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

# Postgres publishes its port before it can serve queries, and the entrypoint
# even runs a throwaway local-socket-only server during init — so a real query
# is the only trustworthy signal. `test` is created by init.sql after the
# POSTGRES_DB (`db`) already exists, so reaching it means both databases are up.
postgres_ready() {
	tcp_open "$POSTGRES_PORT" || return 1

	if has_container postgres; then
		docker compose exec -T postgres \
			psql -U postgres -d test -c 'select 1' >/dev/null 2>&1
	elif command -v psql >/dev/null 2>&1; then
		psql "postgres://postgres:pw@localhost:${POSTGRES_PORT}/test" \
			-c 'select 1' >/dev/null 2>&1
	else
		return 0
	fi
}

redis_ready() {
	local service="$1" port="$2"
	tcp_open "$port" || return 1

	if has_container "$service"; then
		[ "$(docker compose exec -T "$service" redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ]
	else
		return 0
	fi
}

service_ready() {
	case "$1" in
	postgres) postgres_ready ;;
	redis) redis_ready redis "$REDIS_PORT" ;;
	redis-storage) redis_ready redis-storage "$STORAGE_REDIS_PORT" ;;
	esac
}

wait_for() {
	local name="$1" label="$2" waited=0

	while ! service_ready "$name"; do
		if [ "$waited" -ge "$TIMEOUT" ]; then
			echo "✖ ${label} was not ready after ${TIMEOUT}s" >&2
			echo "  hint: check \`docker compose ps\` and \`docker compose logs ${name}\`" >&2
			return 1
		fi
		# Only announce once we've actually had to wait, so the common
		# already-running case stays quiet.
		if [ "$waited" -eq 0 ]; then
			echo "… waiting for ${label} (up to ${TIMEOUT}s)"
		fi
		sleep "$INTERVAL"
		waited=$((waited + INTERVAL))
	done

	echo "✔ ${label} ready"
}

wait_for postgres "Postgres on port ${POSTGRES_PORT}" || exit 1
wait_for redis "Redis on port ${REDIS_PORT}" || exit 1
wait_for redis-storage "Storage Redis on port ${STORAGE_REDIS_PORT}" || exit 1
