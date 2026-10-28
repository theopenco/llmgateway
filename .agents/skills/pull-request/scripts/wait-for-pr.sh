#!/usr/bin/env bash
# Wait until an auto-merge PR merges, or until it needs the agent.
# Exit 0: merged. 1: closed or timed out. 2: usage. 3: needs action (failed
# check, unresolved review thread, merge conflict, branch behind its base, or
# green but still blocked). 4: GitHub requests kept failing.

set -euo pipefail

if [ "$#" -ne 1 ]; then
	echo "usage: $0 <pr-number>" >&2
	exit 2
fi

pr="$1"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
owner="${repo%%/*}"
name="${repo##*/}"
interval="${POLL_SECONDS:-30}"
timeout_min="${TIMEOUT_MINUTES:-180}"
# A required review (risk: high) keeps a green PR blocked; report it after this.
blocked_grace_min="${BLOCKED_GRACE_MINUTES:-15}"

threads_query='query($owner: String!, $name: String!, $pr: Int!) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $pr) {
			reviewThreads(first: 100) {
				nodes { isResolved path line comments(first: 1) { nodes { author { login } body url } } }
			}
		}
	}
}'

unresolved_threads() {
	gh api graphql -f query="$threads_query" -F owner="$owner" -F name="$name" -F pr="$pr" \
		-q '.data.repository.pullRequest.reviewThreads.nodes[]
			| select(.isResolved | not)
			| .comments.nodes[0] as $c
			| "- \(.path):\(.line // "?") \($c.author.login) \($c.url)\n  \($c.body | gsub("```[\\s\\S]*?```"; "") | gsub("<[^>]*>"; "") | gsub("\\s+"; " ") | .[0:300])"'
}

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

max_failures="${MAX_GH_FAILURES:-10}"
err_file=$(mktemp)
trap 'rm -f "$err_file"' EXIT
failures=0
# A network blip must not end the watch: skip the poll, and give up only after
# several failures in a row.
gh_failed() {
	failures=$((failures + 1))
	log "GitHub request failed ($failures/$max_failures)"
	if [ "$failures" -ge "$max_failures" ]; then
		exit 4
	fi
	sleep "$interval"
}

green_since=""
state=""
merge_state=""
deadline=$(($(date +%s) + timeout_min * 60))
while [ "$(date +%s)" -lt "$deadline" ]; do
	if ! status=$(gh pr view "$pr" --json state,mergeStateStatus -q '"\(.state) \(.mergeStateStatus)"'); then
		gh_failed
		continue
	fi
	read -r state merge_state <<<"$status"
	case "$state" in
		MERGED)
			log "merged: $(gh pr view "$pr" --json mergeCommit -q .mergeCommit.oid || echo "commit unavailable")"
			exit 0
			;;
		CLOSED)
			log "closed without merging"
			exit 1
			;;
	esac

	# `gh pr checks` exits 1 on a failing check and 8 while checks are pending,
	# and both still list the checks. Empty output with a non-zero exit is a
	# failed request, unless the PR has no checks yet.
	checks_rc=0
	checks=$(gh pr checks "$pr" 2>"$err_file") || checks_rc=$?
	if [ "$checks_rc" -ne 0 ] && [ -z "$checks" ] && ! grep -q "no checks reported" "$err_file"; then
		gh_failed
		continue
	fi
	failed=$(printf '%s\n' "$checks" | awk -F'\t' '$2 == "fail" {print "- " $1 " " $4}')
	pending=$(printf '%s\n' "$checks" | awk -F'\t' '$2 == "pending" {n++} END {print n + 0}')
	if ! threads=$(unresolved_threads); then
		gh_failed
		continue
	fi
	failures=0

	if [ -n "$failed" ]; then
		log "failed checks:"
		echo "$failed"
		exit 3
	fi
	if [ -n "$threads" ]; then
		log "unresolved review threads (they block auto-merge):"
		echo "$threads"
		exit 3
	fi
	if [ "$merge_state" = "DIRTY" ]; then
		log "merge conflict with the base branch"
		exit 3
	fi
	if [ "$merge_state" = "BEHIND" ]; then
		log "branch is behind the base branch; merge it in and push"
		exit 3
	fi

	if [ "$pending" -eq 0 ] && [ "$merge_state" = "BLOCKED" ]; then
		green_since="${green_since:-$(date +%s)}"
		if [ $(($(date +%s) - green_since)) -ge $((blocked_grace_min * 60)) ]; then
			log "checks green and no open threads, but still blocked (required review?)"
			exit 3
		fi
	else
		green_since=""
	fi

	sleep "$interval"
done

log "timed out after ${timeout_min} minutes ($state $merge_state)"
exit 1
