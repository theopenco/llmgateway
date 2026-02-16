#!/bin/bash

set -eux

curl -X POST --location "http://localhost:4001/v1/chat/completions" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "x-no-fallback: true" \
	-d '{
	"model": "obsidian/gemini-3-pro-image-preview",
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
					"text": "make this image more colorful: https://img.freepik.com/free-photo/los-angeles-downtown-buildings-night_649448-298.jpg?semt=ais_hybrid&w=740&q=80"
				}
			]
		}
	],
	"stream": false
}' | jq -r '.choices[0].message.images[0].image_url.url' | sed 's/data:image\/[^;]*;base64,//' > image.b64

base64 -D -i image.b64 -o output.png

rm image.b64
