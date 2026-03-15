#!/bin/bash

set -eu

BASE_URL="https://api.llmgateway.io"
API_KEY="${LLM_GATEWAY_API_KEY:-test-token}"

POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
	case $1 in
		--local)
			BASE_URL="http://localhost:4001"
			shift
			;;
		*)
			POSITIONAL_ARGS+=("$1")
			shift
			;;
	esac
done

if [ ${#POSITIONAL_ARGS[@]} -lt 2 ]; then
	echo "Usage: $0 [--local] <image-file> <prompt>"
	echo "Example: $0 photo.png \"Turn this into a pixel-art style image\""
	exit 1
fi

IMAGE_FILE="${POSITIONAL_ARGS[0]}"
PROMPT="${POSITIONAL_ARGS[1]}"

if [ ! -f "$IMAGE_FILE" ]; then
	echo "Error: File '$IMAGE_FILE' not found"
	exit 1
fi

MIME_TYPE="image/png"
case "$IMAGE_FILE" in
	*.jpg|*.jpeg) MIME_TYPE="image/jpeg" ;;
	*.png) MIME_TYPE="image/png" ;;
	*.gif) MIME_TYPE="image/gif" ;;
	*.webp) MIME_TYPE="image/webp" ;;
esac

DATE=$(date +%Y%m%d-%H%M%S)

PAYLOAD_FILE=$(mktemp)
trap "rm -f '$PAYLOAD_FILE'" EXIT

# Build chat completions payload with vision input via file to avoid argument-too-long errors
printf '{"model":"gemini-3.1-flash-image-preview","image_config":{"aspect_ratio":"1:1","image_size":"1K"},"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:%s;base64,' "$MIME_TYPE" > "$PAYLOAD_FILE"
base64 -i "$IMAGE_FILE" | tr -d '\n' >> "$PAYLOAD_FILE"
printf '"}},{"type":"text","text":"%s"}]}],"stream":false}' "$PROMPT" >> "$PAYLOAD_FILE"

RESPONSE=$(curl -s -X POST --location "${BASE_URL}/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer ${API_KEY}" \
	-H "x-no-fallback: true" \
	-d @"$PAYLOAD_FILE")

URL=$(echo "$RESPONSE" | jq -r '.choices[0].message.images[0].image_url.url')

if [ -z "$URL" ] || [ "$URL" = "null" ]; then
	echo "Error: Image edit failed"
	echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
	exit 1
fi

OUTPUT="output-edit-${DATE}.png"

echo "$URL" | sed 's/data:image\/[^;]*;base64,//' | base64 -D -o "$OUTPUT"

echo "Image saved to ${OUTPUT}"
