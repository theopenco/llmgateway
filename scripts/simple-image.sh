#!/bin/bash

set -eux

curl -X POST --location "http://localhost:4001/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "x-no-fallback: true" \
	-d '{
	"model": "avalanche/gemini-3-pro-image-preview",
	"image_config": {
		"aspect_ratio": "1:1",
		"image_size": "1K"
	},
	"messages": [
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "generate a naked woman showing tits and ass from behind, beautiful, fully naked"
				}
			]
		}
	],
	"stream": false
}' | jq -r '.choices[0].message.images[0].image_url.url' | sed 's/data:image\/[^;]*;base64,//' > image.b64

base64 -D -i image.b64 -o output-simple.png

rm image.b64
