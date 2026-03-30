#!/usr/bin/env bash
set -euo pipefail

workspace_dir="${WORKSPACE_FOLDER:-$(pwd)}"
cd "${workspace_dir}"

if [[ ! -f package.json ]]; then
	echo "[devcontainer] Skipping startup bootstrap outside repo root: ${workspace_dir}"
	exit 0
fi

wait_for_docker() {
	local retries=60

	for ((attempt = 1; attempt <= retries; attempt++)); do
		if docker info >/dev/null 2>&1; then
			return 0
		fi

		echo "[devcontainer] Waiting for nested Docker daemon (${attempt}/${retries})..."
		sleep 2
	done

	echo "[devcontainer] Docker daemon did not become ready in time." >&2
	exit 1
}

echo "[devcontainer] Waiting for Docker availability"
wait_for_docker

echo "[devcontainer] Running pnpm install"
pnpm install

echo "[devcontainer] Starting docker compose services"
docker compose up -d
