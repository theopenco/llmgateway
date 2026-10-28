#!/usr/bin/env bash
# Wait until a merged commit runs in the cluster kubectl points at.
# Live: every deployment of our ghcr.io/theopenco/llmgateway-* images is ready
# on one image tag whose commit contains <merge-sha>. A later image bump often
# ships the commit first; deployments of third-party images are skipped.
# Extra arguments go to kubectl (e.g. --context <ctx> -n <namespace>).
# Exit 0: live. 1: timed out. 2: usage.

set -euo pipefail

if [ "$#" -lt 1 ]; then
	echo "usage: $0 <merge-sha> [kubectl args...]" >&2
	exit 2
fi

sha="$1"
shift
interval="${POLL_SECONDS:-30}"
timeout_min="${TIMEOUT_MINUTES:-120}"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

deployments() {
	kubectl "$@" get deploy \
		-o custom-columns='NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image,READY:.status.readyReplicas,WANT:.spec.replicas' \
		--no-headers |
		awk '$2 ~ /^ghcr\.io\/theopenco\/llmgateway-/'
}

last=""
deadline=$(($(date +%s) + timeout_min * 60))
while [ "$(date +%s)" -lt "$deadline" ]; do
	rows=$(deployments "$@" || true)
	if [ -z "$rows" ]; then
		log "no llmgateway deployments visible; check the kubectl context"
	else
		tags=$(printf '%s\n' "$rows" | awk '{sub(/.*:v0\.0\.0-/, "", $2); print $2}' | sort -u)
		not_ready=$(printf '%s\n' "$rows" | awk '$3 != $4 {print $1}')
		status="tags: $(echo "$tags" | tr '\n' ' ')not ready: ${not_ready:-none}"
		[ "$status" != "$last" ] && log "$status"
		last="$status"
		if [ -z "$not_ready" ] && [ "$(echo "$tags" | wc -l)" -eq 1 ]; then
			git fetch -q origin
			if git merge-base --is-ancestor "$sha" "$tags" 2>/dev/null; then
				log "live: $sha ships in v0.0.0-$tags"
				printf '%s\n' "$rows"
				exit 0
			fi
		fi
	fi
	sleep "$interval"
done

log "not live after ${timeout_min} minutes"
printf '%s\n' "${rows:-}"
exit 1
