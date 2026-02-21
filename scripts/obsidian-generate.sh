#!/bin/bash

# Test single-turn image generation through the gateway with obsidian/gemini-3-pro-image-preview
# This tests that responseModalities is auto-set for image-output models (no image_config needed)

set -eux

curl -X POST --location "http://localhost:4001/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "x-no-fallback: true" \
	-d '{
	"model": "obsidian/gemini-3-pro-image-preview",
	"messages": [
		{
			"role": "user",
			"content": "Generate a simple image of a red circle on a white background"
		}
	],
	"stream": false
}' | jq '.'
