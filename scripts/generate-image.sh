#!/bin/bash

set -eux

curl -X POST --location "http://localhost:4001/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer test-token" \
	-d '{
	"model": "google-ai-studio/gemini-3-pro-image-preview",
	"image_config": {
		"aspect_ratio": "1:1",
		"image_size": "4K"
	},
	"messages": [
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "Generate an image of a cyberpunk city at night"
				}
			]
		}
	],
	"stream": false
}' | jq -r '.choices[0].message.images[0].image_url.url' | sed 's/data:image\/[^;]*;base64,//' > image.b64

base64 -D -i image.b64 -o output.png

rm image.b64
