#!/bin/sh

set -eu

BASE_URL="https://api.llmgateway.io"
API_KEY="${LLM_GATEWAY_API_KEY:-test-token}"
MODEL=""

while [ "$#" -gt 0 ]; do
	case "$1" in
		--local)
			BASE_URL="http://localhost:4001"
			shift
			;;
		--)
			shift
			break
			;;
		-*)
			echo "Unknown option: $1" >&2
			echo "Usage: $0 [--local] <model>" >&2
			exit 1
			;;
		*)
			MODEL="$1"
			shift
			break
			;;
	esac
done

if [ -z "$MODEL" ]; then
	echo "Usage: $0 [--local] <model>" >&2
	exit 1
fi

DATE=$(date +%Y%m%d-%H%M%S)
TMPFILE=$(mktemp)
URLFILE=$(mktemp)
B64FILE=$(mktemp)
trap 'rm -f "$TMPFILE" "$URLFILE" "$B64FILE"' EXIT

curl -sS -X POST --location "${BASE_URL}/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer ${API_KEY}" \
	-H "x-no-fallback: true" \
	-H "x-debug: true" \
	-o "$TMPFILE" \
	-d '{
		"model": "'"$MODEL"'",
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

if ! jq -er '.choices[0].message.images[0].image_url.url' "$TMPFILE" > "$URLFILE"; then
	echo "No image URL found in response, saving full response to out-${DATE}.json"
	jq . "$TMPFILE" > "out-${DATE}.json"
	exit 1
fi

if ! grep -Eq '^data:image/[^;]*;base64,' "$URLFILE"; then
	echo "Response did not contain a base64 image, saving full response to out-${DATE}.json"
	jq . "$TMPFILE" > "out-${DATE}.json"
	exit 1
fi

sed 's|^data:image/[^;]*;base64,||' "$URLFILE" > "$B64FILE"

OUTPUT="output-${DATE}.png"

if ! base64 -D -i "$B64FILE" -o "$OUTPUT" 2>/dev/null; then
	if ! base64 -d < "$B64FILE" > "$OUTPUT"; then
		echo "Failed to decode image data, saving full response to out-${DATE}.json"
		rm -f "$OUTPUT"
		jq . "$TMPFILE" > "out-${DATE}.json"
		exit 1
	fi
fi

echo "Image saved to ${OUTPUT}"
