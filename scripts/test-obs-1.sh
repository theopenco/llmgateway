#!/bin/bash

BASE_URL="${BASE_URL:-$LLM_OBSIDIAN_BASE_URL}"
API_KEY="${API_KEY:-$LLM_OBSIDIAN_API_KEY}"
MODEL="${MODEL:-gemini-3-pro-image-preview}"

echo "request to $BASE_URL"

OUTPUT_FILE="scripts/test-obs-1-$(date +%Y%m%d-%H%M%S).json"

curl -s "${BASE_URL}/v1beta/models/${MODEL}:generateContent" \
	-H "Content-Type: application/json" \
	-H "x-goog-api-key: ${API_KEY}" \
	-d '{
	"contents": [
		{
			"role": "user",
			"parts": [{"text": "Design a futuristic robot assistant"}]
		}
	],
	"safetySettings": [
		{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
		{"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
		{"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
		{"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
	],
	"generationConfig": {
		"responseModalities": ["TEXT", "IMAGE"]
	}
}' | jq . > "${OUTPUT_FILE}"

echo "Saved to ${OUTPUT_FILE}"
