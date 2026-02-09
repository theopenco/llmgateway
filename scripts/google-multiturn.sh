#!/bin/bash

# Test multi-turn image edit through the gateway with obsidian/gemini-3-pro-image-preview
# This tests that thoughtSignature is preserved on image parts for multi-turn conversations.
#
# Usage:
#   1. First run obsidian-generate.sh and capture the response
#   2. Extract the image URL and extra_content from the response
#   3. Pass them in the assistant message below
#
# The example below shows the expected message structure. Replace the placeholder values
# with actual data from step 1.

set -eux

echo "Step 1: Generate initial image..."
RESPONSE=$(curl -s -X POST --location "http://localhost:4001/v1/chat/completions" \
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
}')

echo "Response from step 1:"
echo "$RESPONSE" | jq '.choices[0].message.content, (.choices[0].message.images | length)'

# Extract the first image and its extra_content for the multi-turn request
IMAGE_URL=$(echo "$RESPONSE" | jq -r '.choices[0].message.images[0].image_url.url')
THOUGHT_SIG=$(echo "$RESPONSE" | jq -r '.choices[0].message.images[0].extra_content.google.thought_signature // empty')
TEXT_CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // "Here is the image."')

if [ -z "$IMAGE_URL" ] || [ "$IMAGE_URL" = "null" ]; then
	echo "ERROR: No image generated in step 1"
	exit 1
fi

echo ""
echo "Step 2: Edit the image (multi-turn)..."

# Build the extra_content for the image part if thoughtSignature exists
if [ -n "$THOUGHT_SIG" ]; then
	EXTRA_CONTENT=", \"extra_content\": {\"google\": {\"thought_signature\": \"$THOUGHT_SIG\"}}"
else
	EXTRA_CONTENT=""
fi

curl -s -X POST --location "http://localhost:4001/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "x-no-fallback: true" \
	-d "{
	\"model\": \"obsidian/gemini-3-pro-image-preview\",
	\"messages\": [
		{
			\"role\": \"user\",
			\"content\": \"Generate a simple image of a red circle on a white background\"
		},
		{
			\"role\": \"assistant\",
			\"content\": [
				{
					\"type\": \"text\",
					\"text\": $(echo "$TEXT_CONTENT" | jq -Rs '.')
				},
				{
					\"type\": \"image_url\",
					\"image_url\": {
						\"url\": \"$IMAGE_URL\"
					}$EXTRA_CONTENT
				}
			]
		},
		{
			\"role\": \"user\",
			\"content\": \"Now change the circle color to blue\"
		}
	],
	\"stream\": false
}" | jq '.choices[0].message.content, (.choices[0].message.images | length)'
