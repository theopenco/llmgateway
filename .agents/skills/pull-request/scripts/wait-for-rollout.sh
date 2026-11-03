#!/usr/bin/env bash
# Wait until a merged commit runs in the cluster kubectl points at.
# Live: every deployment of our ghcr.io/theopenco/llmgateway-* images is ready
# on one image tag whose commit contains <merge-sha>. A later image bump often
# ships the commit first; deployments of third-party images are skipped.
# Extra arguments go to kubectl (e.g. --context <ctx> -n <namespace>).
# Exit 0: live. 1: timed out. 2: usage. 4: kubectl failing or no deployments.

set -euo pipefail

if [ "$#" -lt 1 ]; then
	echo "usage: $0 <merge-sha> [kubectl args...]" >&2
	exit 2
fi

sha="$1"
shift
interval="${POLL_SECONDS:-30}"
timeout_min="${TIMEOUT_MINUTES:-120}"
max_failures="${MAX_KUBECTL_FAILURES:-5}"
request_timeout="${KUBECTL_REQUEST_TIMEOUT:-30s}"

err_file=$(mktemp)
trap 'rm -f "$err_file"' EXIT

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# git has no overall fetch timeout, so a watchdog kills a stalled fetch.
fetch_bounded() {
	git fetch -q origin &
	local fetch_pid=$!
	(
		sleep "${FETCH_TIMEOUT_SECONDS:-60}"
		kill "$fetch_pid" 2>/dev/null
	) &
	local watchdog_pid=$!
	local rc=0
	wait "$fetch_pid" || rc=$?
	kill "$watchdog_pid" 2>/dev/null || true
	wait "$watchdog_pid" 2>/dev/null || true
	return "$rc"
}

# Columns: name, image, want, current, updated, ready, available, generation,
# observed generation. Missing counts print as <none>. The request timeout
# keeps a hung API server from stalling the deadline and failure count.
deployments() {
	kubectl --request-timeout="$request_timeout" "$@" get deploy --no-headers \
		-o custom-columns='NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image,WANT:.spec.replicas,CURRENT:.status.replicas,UPDATED:.status.updatedReplicas,READY:.status.readyReplicas,AVAILABLE:.status.availableReplicas,GEN:.metadata.generation,OBSERVED:.status.observedGeneration'
}

failures=0
last=""
deadline=$(($(date +%s) + timeout_min * 60))
while [ "$(date +%s)" -lt "$deadline" ]; do
	if ! all=$(deployments "$@" 2>"$err_file"); then
		failures=$((failures + 1))
		log "kubectl failed ($failures/$max_failures): $(head -c 300 "$err_file")"
		if [ "$failures" -ge "$max_failures" ]; then
			exit 4
		fi
		sleep "$interval"
		continue
	fi
	failures=0
	rows=$(printf '%s\n' "$all" | awk '$2 ~ /^ghcr\.io\/theopenco\/llmgateway-/')
	if [ -z "$rows" ]; then
		log "no deployments of ghcr.io/theopenco/llmgateway-* images in this context and namespace"
		exit 4
	else
		tags=$(printf '%s\n' "$rows" | awk '{sub(/.*:v0\.0\.0-/, "", $2); print $2}' | sort -u)
		# Rolled out: the controller saw the latest spec, and every pod (no
		# leftovers from the old ReplicaSet) runs it, ready and available.
		not_ready=$(printf '%s\n' "$rows" | awk '$4 != $3 || $5 != $3 || $6 != $3 || $7 != $3 || $9 != $8 {print $1}')
		status="tags: $(echo "$tags" | tr '\n' ' ')not ready: ${not_ready:-none}"
		[ "$status" != "$last" ] && log "$status"
		last="$status"
		if [ -z "$not_ready" ] && [ "$(echo "$tags" | wc -l)" -eq 1 ]; then
			# A failed or stalled fetch only delays the check; the next poll
			# retries it.
			fetch_bounded || log "git fetch failed or timed out; retrying next poll"
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
