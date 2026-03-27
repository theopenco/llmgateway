#!/bin/bash

set -euo pipefail

DEFAULT_API_URL="https://api.llmgateway.io/v1/chat/completions"
DEFAULT_PAYLOAD_FILE="/Users/steebchen/Downloads/messages.json"
DEFAULT_OUTPUT_DIR="scripts/request-logs"
DEFAULT_MAX_REQUESTS="0"
DEFAULT_REQUESTS_PER_MINUTE="30"

API_URL="$DEFAULT_API_URL"
PAYLOAD_FILE="$DEFAULT_PAYLOAD_FILE"
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
MAX_REQUESTS="$DEFAULT_MAX_REQUESTS"
REQUESTS_PER_MINUTE="$DEFAULT_REQUESTS_PER_MINUTE"
INJECT_PAYLOAD=false

usage() {
	echo "Usage: $0 [options]" >&2
	echo >&2
	echo "Options:" >&2
	echo "  --api-url URL                  Default: $DEFAULT_API_URL" >&2
	echo "  --payload-file PATH           Default: $DEFAULT_PAYLOAD_FILE" >&2
	echo "  --output-dir PATH             Default: $DEFAULT_OUTPUT_DIR" >&2
	echo "  --max-requests COUNT          Default: $DEFAULT_MAX_REQUESTS" >&2
	echo "  --requests-per-minute NUMBER  Default: $DEFAULT_REQUESTS_PER_MINUTE" >&2
	echo "  --inject                      Inject a cache-busting prefix into the first system message" >&2
	echo "  -h, --help                    Show this help" >&2
}

require_value() {
	local option="$1"
	local value="${2:-}"

	if [[ -z "$value" ]]; then
		echo "Missing value for ${option}." >&2
		usage
		exit 1
	fi
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--api-url)
		require_value "$1" "${2:-}"
		API_URL="$2"
		shift 2
		continue
		;;
	--api-url=*)
		require_value "${1%%=*}" "${1#*=}"
		API_URL="${1#*=}"
		;;
	--payload-file)
		require_value "$1" "${2:-}"
		PAYLOAD_FILE="$2"
		shift 2
		continue
		;;
	--payload-file=*)
		require_value "${1%%=*}" "${1#*=}"
		PAYLOAD_FILE="${1#*=}"
		;;
	--output-dir)
		require_value "$1" "${2:-}"
		OUTPUT_DIR="$2"
		shift 2
		continue
		;;
	--output-dir=*)
		require_value "${1%%=*}" "${1#*=}"
		OUTPUT_DIR="${1#*=}"
		;;
	--max-requests)
		require_value "$1" "${2:-}"
		MAX_REQUESTS="$2"
		shift 2
		continue
		;;
	--max-requests=*)
		require_value "${1%%=*}" "${1#*=}"
		MAX_REQUESTS="${1#*=}"
		;;
	--requests-per-minute)
		require_value "$1" "${2:-}"
		REQUESTS_PER_MINUTE="$2"
		shift 2
		continue
		;;
	--requests-per-minute=*)
		require_value "${1%%=*}" "${1#*=}"
		REQUESTS_PER_MINUTE="${1#*=}"
		;;
	--inject)
		INJECT_PAYLOAD=true
		;;
	-h | --help)
		usage
		exit 0
		;;
	-*)
		echo "Unknown option: $1" >&2
		usage
		exit 1
		;;
	*)
		echo "Positional arguments are not supported: $1" >&2
		usage
		exit 1
		;;
	esac

	shift
done

if ! [[ "$REQUESTS_PER_MINUTE" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
	echo "Requests per minute must be a positive number." >&2
	usage
	exit 1
fi

if ! [[ "$MAX_REQUESTS" =~ ^[0-9]+$ ]]; then
	echo "Max requests must be a non-negative integer." >&2
	usage
	exit 1
fi

if awk "BEGIN { exit !($REQUESTS_PER_MINUTE > 0) }"; then
	INTERVAL_SECONDS="$(awk "BEGIN { printf \"%.6f\", 60 / $REQUESTS_PER_MINUTE }")"
else
	echo "Requests per minute must be greater than 0." >&2
	exit 1
fi

if [[ -z "${LLM_GATEWAY_API_KEY:-}" ]]; then
	echo "LLM_GATEWAY_API_KEY is required." >&2
	exit 1
fi

if [[ ! -f "$PAYLOAD_FILE" ]]; then
	echo "Payload file not found: $PAYLOAD_FILE" >&2
	exit 1
fi

if [[ "$INJECT_PAYLOAD" == "true" ]] && ! command -v jq >/dev/null 2>&1; then
	echo "jq is required." >&2
	exit 1
fi

REQUEST_URL="$API_URL"
if [[ "$REQUEST_URL" != */v1/chat/completions ]]; then
	REQUEST_URL="${REQUEST_URL%/}/v1/chat/completions"
fi

mkdir -p "$OUTPUT_DIR"

echo "Sending ${REQUESTS_PER_MINUTE} request(s) per minute (${INTERVAL_SECONDS}s between launches)."
echo "Payload injection: ${INJECT_PAYLOAD}"
echo "Request URL: ${REQUEST_URL}"

stop_requests() {
	echo
	echo "Stopping launcher and terminating in-flight requests..." >&2

	while read -r pid; do
		kill "$pid" 2>/dev/null || true
	done < <(jobs -pr)

	wait || true
	exit 0
}

trap stop_requests INT TERM

request_count=0

while true; do
	request_count=$((request_count + 1))
	timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
	output_file="${OUTPUT_DIR}/chat-completion-${request_count}-${timestamp}.json"

	echo "[$(date +"%Y-%m-%d %H:%M:%S")] starting request #${request_count} -> ${output_file}"

	(
		temp_payload=""
		request_payload="$PAYLOAD_FILE"
		trap '[[ -n "$temp_payload" ]] && rm -f "$temp_payload"' EXIT

		if [[ "$INJECT_PAYLOAD" == "true" ]]; then
			cache_buster="$(date -u +"%Y-%m-%dT%H:%M:%S").$(python3 -c 'import time; print(f"{time.time_ns() % 1_000_000_000:09d}")' 2>/dev/null || date -u +"000000000")Z"
			temp_payload="$(mktemp)"

			jq --arg prefix "[ts:${cache_buster}] " '
				def inject_prefix:
					reduce range(0; length) as $i (
						{updated: false, items: .};
						if .updated then
							.
						elif .items[$i].role == "system" then
							.updated = true |
							.items[$i].content = (
								if (.items[$i].content | type) == "string" then
									$prefix + .items[$i].content
								elif (.items[$i].content | type) == "array" then
									[{type: "text", text: $prefix}] + .items[$i].content
								else
									.items[$i].content
								end
							)
						else
							.
						end
					) | .items;

				if (.messages | type) != "array" then
					error("payload must contain a messages array")
				elif ([.messages[] | select(.role == "system")] | length) == 0 then
					error("payload must contain at least one system message")
				else
					.messages |= inject_prefix
				end
			' "$PAYLOAD_FILE" > "$temp_payload"

			request_payload="$temp_payload"
		fi

		curl -N "$REQUEST_URL" -s \
			-H "Content-Type: application/json" \
			-H "Authorization: Bearer ${LLM_GATEWAY_API_KEY}" \
			-H "X-No-Fallback: true" \
			-d "@${request_payload}" \
			>"$output_file"
	) &

	if [[ "$MAX_REQUESTS" -gt 0 && "$request_count" -ge "$MAX_REQUESTS" ]]; then
		break
	fi

	sleep "$INTERVAL_SECONDS"
done

echo "Launched ${request_count} request(s). Waiting for in-flight requests to finish..."
wait || true
