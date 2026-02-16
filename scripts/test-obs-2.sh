#!/bin/bash

BASE_URL="${BASE_URL:-$LLM_OBSIDIAN_BASE_URL}"
API_KEY="${API_KEY:-$LLM_OBSIDIAN_API_KEY}"
MODEL="${MODEL:-gemini-3-pro-image-preview}"

echo "request to $BASE_URL"

INPUT_FILE="${1:?Usage: test-obs-2.sh <response-from-step-1.json>}"
OUTPUT_FILE="scripts/test-obs-2-$(date +%Y%m%d-%H%M%S).json"

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# Build multi-turn payload by reading model response parts from step 1 output
jq -n --slurpfile resp "$INPUT_FILE" '{
	contents: [
		{role: "user", parts: [{text: "Design a futuristic robot assistant"}]},
		{role: "model", parts: $resp[0].candidates[0].content.parts},
		{role: "user", parts: [{text: "make it more futuristic"}]}
	],
	safetySettings: [
		{category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE"},
		{category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE"},
		{category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE"},
		{category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE"}
	],
	generationConfig: {
		responseModalities: ["TEXT", "IMAGE"]
	}
}' > "$TMPFILE"

curl -s "${BASE_URL}/v1beta/models/${MODEL}:generateContent" \
	-H "Content-Type: application/json" \
	-H "x-goog-api-key: ${API_KEY}" \
	-d "@${TMPFILE}" | jq . > "${OUTPUT_FILE}"

echo "Saved to ${OUTPUT_FILE}"
