#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "Usage: $0 <image1> [image2 ...]" >&2
	echo "Env: PROMPT, OUTPUT_FILE, GATEWAY_URL, TOKEN, MODEL, N, ASPECT_RATIO, SIZE, QUALITY, RESPONSE_FILE" >&2
	exit 1
fi

IMAGES=("$@")

PROMPT=${PROMPT:-"Combine these images into one polished product-style scene. Keep the main subject from the first image, borrow the background mood and lighting from the remaining images, and make the result feel cohesive and photorealistic."}

GATEWAY_URL=${GATEWAY_URL:-http://localhost:4001}
TOKEN=${TOKEN:-test-token}
MODEL=${MODEL:-google-vertex/gemini-3.1-flash-image-preview}
MODEL_FILENAME=${MODEL//\//--}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUTPUT_FILE=${OUTPUT_FILE:-.context/${MODEL_FILENAME}-${TIMESTAMP}.png}
N=${N:-1}
RESPONSE_FILE=${RESPONSE_FILE:-.context/image-edit-response-${TIMESTAMP}.json}

mkdir -p "$(dirname "$OUTPUT_FILE")"
mkdir -p "$(dirname "$RESPONSE_FILE")"

TMPDIR_WORK=$(mktemp -d)
trap 'rm -rf "$TMPDIR_WORK"' EXIT

IMAGE_LIST_FILE="$TMPDIR_WORK/images.txt"
: > "$IMAGE_LIST_FILE"
for img in "${IMAGES[@]}"; do
	printf '%s\n' "$img" >> "$IMAGE_LIST_FILE"
done

PAYLOAD_FILE="$TMPDIR_WORK/payload.json"

env_args=(
	MODEL="$MODEL"
	PROMPT="$PROMPT"
	N="$N"
	IMAGE_LIST_FILE="$IMAGE_LIST_FILE"
	PAYLOAD_FILE="$PAYLOAD_FILE"
)
[[ -n "${ASPECT_RATIO:-}" ]] && env_args+=(ASPECT_RATIO="$ASPECT_RATIO")
[[ -n "${SIZE:-}" ]] && env_args+=(SIZE="$SIZE")
[[ -n "${QUALITY:-}" ]] && env_args+=(QUALITY="$QUALITY")

env "${env_args[@]}" python3 <<'PY'
import base64
import json
import mimetypes
import os
import pathlib
import subprocess

def mime_type(path: pathlib.Path) -> str:
    guess, _ = mimetypes.guess_type(str(path))
    if guess:
        return guess
    try:
        out = subprocess.check_output(["file", "--brief", "--mime-type", str(path)])
        return out.decode().strip()
    except Exception:
        return "application/octet-stream"

def data_url(path: pathlib.Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime_type(path)};base64,{encoded}"

list_path = pathlib.Path(os.environ["IMAGE_LIST_FILE"])
payload_path = pathlib.Path(os.environ["PAYLOAD_FILE"])

images = []
for line in list_path.read_text().splitlines():
    line = line.strip()
    if not line:
        continue
    images.append({"image_url": data_url(pathlib.Path(line).expanduser())})

payload = {
    "model": os.environ["MODEL"],
    "prompt": os.environ["PROMPT"],
    "images": images,
    "n": int(os.environ["N"]),
}

for env_key, payload_key in (
    ("ASPECT_RATIO", "aspect_ratio"),
    ("SIZE", "size"),
    ("QUALITY", "quality"),
):
    value = os.environ.get(env_key)
    if value:
        payload[payload_key] = value

with payload_path.open("w") as f:
    json.dump(payload, f)
PY

curl -sS -X POST "$GATEWAY_URL/v1/images/edits" \
	-H "Authorization: Bearer $TOKEN" \
	-H "Content-Type: application/json" \
	-H "X-No-Fallback: true" \
	--data-binary "@$PAYLOAD_FILE" > "$RESPONSE_FILE"

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
