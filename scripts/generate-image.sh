#!/bin/bash

set -eu

BASE_URL="https://api.llmgateway.io"
API_KEY="${LLM_GATEWAY_API_KEY:-test-token}"

if [ "${1:-}" = "--local" ]; then
	BASE_URL="http://localhost:4001"
fi

DATE=$(date +%Y%m%d-%H%M%S)
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE" image.b64' EXIT

curl -X POST --location "${BASE_URL}/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer ${API_KEY}" \
	-H "x-no-fallback: true" \
	-H "x-debug: true" \
	-o "$TMPFILE" \
	-d '{
	"model": "obsidian/gemini-3.1-flash-image-preview",
	"image_config": {
		"aspect_ratio": "1:1",
		"image_size": "0.5K"
	},
	"messages": [
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "make this image more colorful: https://img.freepik.com/free-photo/los-angeles-downtown-buildings-night_649448-298.jpg?semt=ais_hybrid&w=740&q=80"
				}
			]
		}
	],
	"stream": false
}'

URL=$(jq -r '.choices[0].message.images[0].image_url.url' "$TMPFILE")

if [ -z "$URL" ] || [ "$URL" = "null" ]; then
	echo "No image URL found in response, saving full response to out-${DATE}.json"
	jq . "$TMPFILE" > "out-${DATE}.json"
	exit 1
fi

OUTPUT="output-${DATE}.png"

echo "$URL" | sed 's/data:image\/[^;]*;base64,//' > image.b64

base64 -D -i image.b64 -o "$OUTPUT"

echo "Image saved to ${OUTPUT}"
