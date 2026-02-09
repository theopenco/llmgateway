#!/bin/bash

BASE_URL="${BASE_URL:-https://generativelanguage.googleapis.com}"
API_KEY="${API_KEY:-$LLM_GOOGLE_AI_STUDIO_API_KEY}"
MODEL="${MODEL:-gemini-3-pro-image-preview}"

OUTPUT_FILE="scripts/test-obs-$(date +%Y%m%d-%H%M%S).json"

curl -s "${BASE_URL}/v1beta/models/${MODEL}:generateContent" \
	-H "Content-Type: application/json" \
	-H "x-goog-api-key: ${API_KEY}" \
	-d '{
	"contents": [
		{
			"role": "user",
			"parts": [{"text": "Design a futuristic robot assistant"}]
		},
		{
			"role": "model",
			"parts": [{"text": ""}]
		},
		{
			"role": "user",
			"parts": [{"text": "make it more futuristic"}]
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
