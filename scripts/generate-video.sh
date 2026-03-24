#!/bin/sh

set -eu

BASE_URL="https://api.llmgateway.io"
API_KEY="${LLM_GATEWAY_API_KEY:-test-token}"
MODEL="veo-3.1-generate-preview"
SIZE=""
SECONDS=""
PROMPT=""
OUTPUT=""
POLL_INTERVAL="5"
CALLBACK_URL=""
CALLBACK_SECRET=""
PROMPT_ARGS=""

usage() {
	echo "Usage: $0 [--local] [--model MODEL] [--size WIDTHxHEIGHT] --seconds SECONDS [--output FILE] [--interval SECONDS] [--callback-url URL --callback-secret SECRET] <prompt>" >&2
	exit 1
}

log() {
	printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

require_command jq
require_command curl

while [ "$#" -gt 0 ]; do
	case "$1" in
		--local)
			BASE_URL="http://localhost:4001"
			shift
			;;
		--model)
			[ "$#" -ge 2 ] || usage
			MODEL="$2"
			shift 2
			;;
		--size)
			[ "$#" -ge 2 ] || usage
			SIZE="$2"
			shift 2
			;;
		--seconds|--duration)
			[ "$#" -ge 2 ] || usage
			SECONDS="$2"
			shift 2
			;;
		--output)
			[ "$#" -ge 2 ] || usage
			OUTPUT="$2"
			shift 2
			;;
		--interval)
			[ "$#" -ge 2 ] || usage
			POLL_INTERVAL="$2"
			shift 2
			;;
		--callback-url)
			[ "$#" -ge 2 ] || usage
			CALLBACK_URL="$2"
			shift 2
			;;
		--callback-secret)
			[ "$#" -ge 2 ] || usage
			CALLBACK_SECRET="$2"
			shift 2
			;;
		-h|--help)
			usage
			;;
		--)
			shift
			break
			;;
		-*)
			echo "Unknown option: $1" >&2
			usage
			;;
		*)
			if [ -n "$PROMPT_ARGS" ]; then
				PROMPT_ARGS="$PROMPT_ARGS $1"
			else
				PROMPT_ARGS="$1"
			fi
			shift
			;;
	esac
done

PROMPT="$PROMPT_ARGS"

if [ -z "$PROMPT" ]; then
	usage
fi

if [ -z "$SECONDS" ]; then
	echo "seconds is required" >&2
	exit 1
fi

if [ -n "$CALLBACK_URL" ] && [ -z "$CALLBACK_SECRET" ]; then
	echo "callback_secret is required when callback_url is set" >&2
	exit 1
fi

if [ -z "$CALLBACK_URL" ] && [ -n "$CALLBACK_SECRET" ]; then
	echo "callback_url is required when callback_secret is set" >&2
	exit 1
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CREATE_RESPONSE_FILE=$(mktemp)
STATUS_RESPONSE_FILE=$(mktemp)
FINAL_RESPONSE_FILE=$(mktemp)
trap 'rm -f "$CREATE_RESPONSE_FILE" "$STATUS_RESPONSE_FILE" "$FINAL_RESPONSE_FILE"' EXIT

PAYLOAD=$(
	jq -n \
		--arg model "$MODEL" \
		--arg size "$SIZE" \
		--arg seconds "$SECONDS" \
		--arg prompt "$PROMPT" \
		--arg callback_url "$CALLBACK_URL" \
		--arg callback_secret "$CALLBACK_SECRET" \
		'{
			model: $model,
			prompt: $prompt
		}
		+ (
			if $size != "" then
				{
					size: $size
				}
			else
				{}
			end
		)
		+ {
			seconds: ($seconds | tonumber)
		}
		+ (
			if $callback_url != "" then
				{
					callback_url: $callback_url,
					callback_secret: $callback_secret
				}
			else
				{}
			end
		)'
)

log "Creating video job"
log "base_url=${BASE_URL} model=${MODEL} size=${SIZE:-default} seconds=${SECONDS}"
CREATE_STATUS=$(
	curl -sS \
		-o "$CREATE_RESPONSE_FILE" \
		-w "%{http_code}" \
		-X POST "${BASE_URL}/v1/videos" \
		-H "Content-Type: application/json" \
		-H "Authorization: Bearer ${API_KEY}" \
		-H "x-no-fallback: true" \
		-d "$PAYLOAD"
)

if [ "$CREATE_STATUS" -ne 200 ]; then
	log "Create request failed with status ${CREATE_STATUS}"
	jq . "$CREATE_RESPONSE_FILE" 2>/dev/null || cat "$CREATE_RESPONSE_FILE"
	exit 1
fi

log "Create response"
jq . "$CREATE_RESPONSE_FILE"

VIDEO_ID=$(jq -r '.id' "$CREATE_RESPONSE_FILE")
if [ -z "$VIDEO_ID" ] || [ "$VIDEO_ID" = "null" ]; then
	log "Create response did not contain a video id"
	exit 1
fi

if [ -z "$OUTPUT" ]; then
	OUTPUT="video-${VIDEO_ID}-${TIMESTAMP}.mp4"
fi

START_TIME=$(date +%s)
LAST_STATUS=""
LAST_PROGRESS=""

while :; do
	STATUS_CODE=$(
		curl -sS \
			-o "$STATUS_RESPONSE_FILE" \
			-w "%{http_code}" \
			-H "Authorization: Bearer ${API_KEY}" \
			"${BASE_URL}/v1/videos/${VIDEO_ID}"
	)

	if [ "$STATUS_CODE" -ne 200 ]; then
		log "Status request failed with status ${STATUS_CODE}"
		jq . "$STATUS_RESPONSE_FILE" 2>/dev/null || cat "$STATUS_RESPONSE_FILE"
		exit 1
	fi

	STATUS=$(jq -r '.status' "$STATUS_RESPONSE_FILE")
	PROGRESS=$(jq -r '.progress // "null"' "$STATUS_RESPONSE_FILE")
	ELAPSED=$(( $(date +%s) - START_TIME ))

	if [ "$STATUS" != "$LAST_STATUS" ] || [ "$PROGRESS" != "$LAST_PROGRESS" ]; then
		log "Job ${VIDEO_ID}: status=${STATUS} progress=${PROGRESS} elapsed=${ELAPSED}s"
		LAST_STATUS="$STATUS"
		LAST_PROGRESS="$PROGRESS"
	fi

	case "$STATUS" in
		completed)
			cp "$STATUS_RESPONSE_FILE" "$FINAL_RESPONSE_FILE"
			break
			;;
		failed|canceled|expired)
			log "Video job ended with status ${STATUS}"
			jq . "$STATUS_RESPONSE_FILE"
			exit 1
			;;
	esac

	sleep "$POLL_INTERVAL"
done

log "Final video job payload"
jq . "$FINAL_RESPONSE_FILE"

log "Downloading content to ${OUTPUT}"
CONTENT_STATUS=$(
	curl -sS \
		-o "$OUTPUT" \
		-w "%{http_code}" \
		-H "Authorization: Bearer ${API_KEY}" \
		"${BASE_URL}/v1/videos/${VIDEO_ID}/content"
)

if [ "$CONTENT_STATUS" -ne 200 ]; then
	log "Content download failed with status ${CONTENT_STATUS}"
	rm -f "$OUTPUT"
	exit 1
fi

FILE_SIZE=$(wc -c < "$OUTPUT" | tr -d ' ')
log "Download complete: ${OUTPUT} (${FILE_SIZE} bytes)"
