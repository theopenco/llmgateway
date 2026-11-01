#!/bin/sh
# usage: KUBE_CONTEXT=<production context> fetch.sh "<from UTC>" "<to UTC>" <out.ndjson.gz>
# Runs dump.js in the production worker and retries until the gzip is complete.
# kubectl exec streams drop on long runs, so keep windows to about 20 minutes.
set -u
: "${KUBE_CONTEXT:?set KUBE_CONTEXT to the production cluster context}"
NAMESPACE=${NAMESPACE:-default}
JS=$(cat "$(dirname "$0")/dump.js")
for attempt in 1 2 3 4 5 6; do
	kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" --request-timeout=0 \
		exec deploy/llmgateway-worker -- \
		env FROM="$1" TO="$2" sh -c 'cd /app && node -e "$0"' "$JS" \
		>"$3.part" 2>"$3.err"
	if gunzip -t "$3.part" 2>/dev/null && gunzip -c "$3.part" | tail -1 | grep -q '"__total"'; then
		mv "$3.part" "$3"
		rm -f "$3.err"
		echo "$3 $(gunzip -c "$3" | tail -1)"
		exit 0
	fi
	echo "$3 attempt $attempt failed: $(tail -1 "$3.err")" >&2
	sleep 10
done
exit 1
