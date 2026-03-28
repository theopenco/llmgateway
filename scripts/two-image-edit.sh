#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
	echo "Usage: $0 <image1> <image2> [prompt] [output.png]" >&2
	exit 1
fi

IMAGE1=$1
IMAGE2=$2
PROMPT=${3:-"Combine these two images into one polished product-style scene. Keep the main subject from the first image, borrow the background mood and lighting from the second image, and make the result feel cohesive and photorealistic."}
OUTPUT_FILE=${4:-.context/quartz-two-image-edit-output.png}

GATEWAY_URL=${GATEWAY_URL:-http://localhost:4001}
TOKEN=${TOKEN:-test-token}
MODEL=${MODEL:-quartz/gemini-3.1-flash-image-preview}
ASPECT_RATIO=${ASPECT_RATIO:-1:1}
SIZE=${SIZE:-1K}
QUALITY=${QUALITY:-high}
RESPONSE_FILE=${RESPONSE_FILE:-.context/quartz-two-image-edit-response.json}

mime_type() {
	file --brief --mime-type "$1"
}

data_url() {
	local path=$1
	local mime
	mime=$(mime_type "$path")
	local encoded
	encoded=$(base64 < "$path" | tr -d '\n')
	printf 'data:%s;base64,%s' "$mime" "$encoded"
}

IMAGE1_URL=$(data_url "$IMAGE1")
IMAGE2_URL=$(data_url "$IMAGE2")

mkdir -p "$(dirname "$OUTPUT_FILE")"
mkdir -p "$(dirname "$RESPONSE_FILE")"

curl -sS -X POST "$GATEWAY_URL/v1/images/edits" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-d @- <<EOF > "$RESPONSE_FILE"
{
	"model": "$MODEL",
	"prompt": $(printf '%s' "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
	"images": [
		{
			"image_url": "$IMAGE1_URL"
		},
		{
			"image_url": "$IMAGE2_URL"
		}
	],
	"aspect_ratio": "$ASPECT_RATIO",
	"size": "$SIZE",
	"quality": "$QUALITY",
	"n": 1
}
EOF

python3 - "$RESPONSE_FILE" "$OUTPUT_FILE" <<'PY'
import base64
import json
import pathlib
import sys

response_path = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])

with response_path.open() as f:
    payload = json.load(f)

data = payload.get("data") or []
if not data:
    raise SystemExit(f"No images returned. See {response_path}")

b64 = data[0].get("b64_json")
if not b64:
    raise SystemExit(f"Response missing data[0].b64_json. See {response_path}")

output_path.write_bytes(base64.b64decode(b64))
print(f"Wrote {output_path}")
print(f"Saved response JSON to {response_path}")
PY
