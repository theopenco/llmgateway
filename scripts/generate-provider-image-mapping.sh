#!/usr/bin/env bash

set -euo pipefail

BASE_URL="http://localhost:4001"
API_KEY="${LLM_GATEWAY_API_KEY:-test-token}"
PROVIDER="glacier"
MODEL="gemini-3.1-flash-image-preview"
ASPECT_RATIO="1:1"
EDIT_SIZE="1K"
MAX_JOBS="${MAX_JOBS:-10}"
GENERATION_PROMPT="Generate a polished editorial-quality hero image of a brutalist concrete house on a cliff above the ocean at blue hour, with cinematic lighting, crisp material detail, realistic water, and no text."
EDIT_PROMPT="Join these two images together into one cohesive composition. Keep the main subjects from both inputs, blend their framing and lighting naturally, and return a single polished edited image."

FROM_IMAGES=()
JOB_PIDS=()

usage() {
	cat <<'EOF'
Usage: scripts/generate-provider-image-mapping.sh [options]

Options:
  --local                 Use http://localhost:4001
  --base-url URL          Override the API base URL
  --provider NAME         Provider id (default: glacier)
  --model NAME            Model id (default: gemini-3.1-flash-image-preview)
  --mapping P/M           Provider/model mapping shorthand
  --prompt TEXT           Prompt for generated images
  --edit-prompt TEXT      Prompt for the optional two-image edit
  --aspect-ratio VALUE    Aspect ratio for generation/edit (default: 1:1)
  --edit-size VALUE       Image size for the optional edit (default: 1K)
  --jobs N                Max concurrent requests (default: 10)
  --from PATH             Input image for the optional edit, pass exactly twice
  --help                  Show this help text

Examples:
  scripts/generate-provider-image-mapping.sh --local
  scripts/generate-provider-image-mapping.sh \
    --mapping quartz/gemini-3-pro-image-preview
  scripts/generate-provider-image-mapping.sh \
    --from first.png \
    --from second.png \
    --edit-prompt "Join these into one cinematic poster"
EOF
}

cleanup_background_jobs() {
	local pid

	for pid in "${JOB_PIDS[@]:-}"; do
		kill "$pid" 2>/dev/null || true
	done
}

trap cleanup_background_jobs EXIT

supported_sizes() {
	case "$1" in
		gemini-3.1-flash-image-preview)
			printf '%s\n' "0.5K" "1K" "2K" "4K"
			;;
		gemini-3-pro-image-preview)
			printf '%s\n' "1K" "2K" "4K"
			;;
		*)
			echo "Unsupported image model: $1" >&2
			echo "Expected gemini-3.1-flash-image-preview or gemini-3-pro-image-preview" >&2
			exit 1
			;;
	esac
}

size_label() {
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

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

decode_image_url() {
	local image_url=$1
	local output_path=$2
	local base64_file
	base64_file=$(mktemp)
	printf '%s' "$image_url" | sed 's|^data:image/[^;]*;base64,||' > "$base64_file"

	if ! base64 -D -i "$base64_file" -o "$output_path" 2>/dev/null; then
		if ! base64 -d < "$base64_file" > "$output_path"; then
			rm -f "$base64_file" "$output_path"
			echo "Failed to decode image response into $output_path" >&2
			exit 1
		fi
	fi

	rm -f "$base64_file"
}

run_generation() {
	local mapping=$1
	local size=$2
	local output_dir=$3
	local payload_file
	local response_file
	local output_file
	local image_url
	local label

	label=$(size_label "$size")
	payload_file=$(mktemp)
	response_file="$output_dir/generate-$label.json"
	output_file="$output_dir/generate-$label.png"

	jq -n \
		--arg model "$mapping" \
		--arg prompt "$GENERATION_PROMPT" \
		--arg aspectRatio "$ASPECT_RATIO" \
		--arg imageSize "$size" \
		'{
			model: $model,
			image_config: {
				aspect_ratio: $aspectRatio,
				image_size: $imageSize
			},
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: $prompt
						}
					]
				}
			],
			stream: false
		}' > "$payload_file"

	curl -sS -X POST "$BASE_URL/v1/chat/completions" \
		-H "Authorization: Bearer $API_KEY" \
		-H "Content-Type: application/json" \
		-H "x-no-fallback: true" \
		-H "x-debug: true" \
		-o "$response_file" \
		-d @"$payload_file"

	rm -f "$payload_file"

	image_url=$(jq -r '.choices[0].message.images[0].image_url.url // empty' "$response_file")
	if [[ -z "$image_url" ]]; then
		echo "Generation failed for $mapping at $size. See $response_file" >&2
		exit 1
	fi

	decode_image_url "$image_url" "$output_file"
	echo "Saved $size generation to $output_file"
}

run_edit() {
	local mapping=$1
	local output_dir=$2
	local payload_file
	local response_file
	local output_file
	local image_url
	local image_one_url
	local image_two_url
	local label

	image_one_url=$(data_url "${FROM_IMAGES[0]}")
	image_two_url=$(data_url "${FROM_IMAGES[1]}")
	label=$(size_label "$EDIT_SIZE")
	payload_file=$(mktemp)
	response_file="$output_dir/edit-join-$label.json"
	output_file="$output_dir/edit-join-$label.png"

	jq -n \
		--arg model "$mapping" \
		--arg prompt "$EDIT_PROMPT" \
		--arg aspectRatio "$ASPECT_RATIO" \
		--arg imageSize "$EDIT_SIZE" \
		--arg imageOne "$image_one_url" \
		--arg imageTwo "$image_two_url" \
		'{
			model: $model,
			image_config: {
				aspect_ratio: $aspectRatio,
				image_size: $imageSize
			},
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: {
								url: $imageOne
							}
						},
						{
							type: "image_url",
							image_url: {
								url: $imageTwo
							}
						},
						{
							type: "text",
							text: $prompt
						}
					]
				}
			],
			stream: false
		}' > "$payload_file"

	curl -sS -X POST "$BASE_URL/v1/chat/completions" \
		-H "Authorization: Bearer $API_KEY" \
		-H "Content-Type: application/json" \
		-H "x-no-fallback: true" \
		-H "x-debug: true" \
		-o "$response_file" \
		-d @"$payload_file"

	rm -f "$payload_file"

	image_url=$(jq -r '.choices[0].message.images[0].image_url.url // empty' "$response_file")
	if [[ -z "$image_url" ]]; then
		echo "Edit failed for $mapping. See $response_file" >&2
		exit 1
	fi

	decode_image_url "$image_url" "$output_file"
	echo "Saved edit output to $output_file"
}

wait_for_oldest_job() {
	if [[ ${#JOB_PIDS[@]} -eq 0 ]]; then
		return
	fi

	wait "${JOB_PIDS[0]}"
	JOB_PIDS=("${JOB_PIDS[@]:1}")
}

enqueue_job() {
	"$@" &
	JOB_PIDS+=("$!")

	if (( ${#JOB_PIDS[@]} >= MAX_JOBS )); then
		wait_for_oldest_job
	fi
}

wait_for_all_jobs() {
	while [[ ${#JOB_PIDS[@]} -gt 0 ]]; do
		wait_for_oldest_job
	done
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--local)
			BASE_URL="http://localhost:4001"
			shift
			;;
		--base-url)
			BASE_URL="$2"
			shift 2
			;;
		--provider)
			PROVIDER="$2"
			shift 2
			;;
		--model)
			MODEL="$2"
			shift 2
			;;
		--mapping)
			PROVIDER="${2%%/*}"
			MODEL="${2#*/}"
			if [[ "$PROVIDER" == "$MODEL" ]]; then
				echo "Invalid mapping: $2" >&2
				echo "Expected provider/model" >&2
				exit 1
			fi
			shift 2
			;;
		--prompt)
			GENERATION_PROMPT="$2"
			shift 2
			;;
		--edit-prompt)
			EDIT_PROMPT="$2"
			shift 2
			;;
		--aspect-ratio)
			ASPECT_RATIO="$2"
			shift 2
			;;
		--edit-size)
			EDIT_SIZE="$2"
			shift 2
			;;
		--jobs)
			MAX_JOBS="$2"
			shift 2
			;;
		--from)
			FROM_IMAGES+=("$2")
			shift 2
			;;
		--help|-h)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ ${#FROM_IMAGES[@]} -ne 0 && ${#FROM_IMAGES[@]} -ne 2 ]]; then
	echo "Pass exactly two --from images to run the edit flow" >&2
	exit 1
fi

if ! [[ "$MAX_JOBS" =~ ^[0-9]+$ ]] || (( MAX_JOBS < 1 )); then
	echo "--jobs must be a positive integer" >&2
	exit 1
fi

for input_image in "${FROM_IMAGES[@]}"; do
	if [[ ! -f "$input_image" ]]; then
		echo "Input image not found: $input_image" >&2
		exit 1
	fi
done

MAPPING="$PROVIDER/$MODEL"
OUTPUT_DIR=".context/$PROVIDER/$MODEL"
mkdir -p "$OUTPUT_DIR"

echo "Running image mapping requests with up to $MAX_JOBS concurrent job(s)"

while IFS= read -r size; do
	enqueue_job run_generation "$MAPPING" "$size" "$OUTPUT_DIR"
done < <(supported_sizes "$MODEL")

if [[ ${#FROM_IMAGES[@]} -eq 2 ]]; then
	enqueue_job run_edit "$MAPPING" "$OUTPUT_DIR"
fi

wait_for_all_jobs

echo "Finished writing artifacts to $OUTPUT_DIR"
