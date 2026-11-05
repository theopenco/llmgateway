---
id: "121"
slug: "gpt-image-2-6-svg"
date: "2026-11-05"
title: "GPT Image 2.6 With Native SVG Output"
summary: "OpenAI's GPT Image 2.6 Sunburst and Flare are live, and /v1/images/generations now returns vector graphics with output_format: svg. Generate icons, logos, stickers, and illustrations as editable SVG through your existing gateway key."
tags: ["llmgateway"]
image:
  src: "/changelog/gpt-image-2-6-svg.png"
  alt: "LLM Gateway card announcing GPT Image 2.6 with native SVG output"
  width: 1200
  height: 630
---

Icons, logos, and stickers need to scale, recolor, and ship as code. A PNG from
an image model means a second tool to trace it into vectors. **GPT Image 2.6**
draws the vectors itself: set `output_format: "svg"` and the gateway returns an
SVG document you can drop into a page or open in a design tool.

## Two new models

| Model                           | Use it for                               |
| ------------------------------- | ---------------------------------------- |
| `openai/gpt-image-2.6-sunburst` | Detailed compositions and precise edits  |
| `openai/gpt-image-2.6-flare`    | Fast iteration on generation and editing |

Both accept text and image inputs, support `low`, `medium`, `high`, `xhigh`,
`max`, and `auto` quality, and work on `/v1/images/generations`,
`/v1/images/edits`, and `/v1/chat/completions`.

## Generate an SVG

```bash
curl https://api.llmgateway.io/v1/images/generations \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-image-2.6-flare",
    "prompt": "A flat two-color sticker of a smiling cactus",
    "output_format": "svg"
  }' | jq -r '.data[0].b64_json' | base64 --decode > cactus.svg
```

`data[0].b64_json` holds the base64-encoded SVG, and the response echoes
`"output_format": "svg"`. The document is static vector content: no scripts,
external resources, or embedded raster images.

- `n` must be `1`; `output_compression` and streaming are not available for SVG.
- SVG is a generation format. `/v1/images/edits` returns raster images.
- A model without SVG output gets a `400` before any provider is called.

`/v1/images/generations` also accepts `png`, `jpeg`, and `webp` through
`output_format`, plus `output_compression` for the last two.

## Pricing

GPT Image 2.6 uses the same token rates as GPT Image 2 and 2.5. For SVG output,
OpenAI first renders a reference image, then an authoring model writes the
vectors. Both are billed from the reported usage: image tokens at the image
model's rates and the authoring tokens at the authoring model's rates, shown in
`usage.cost`. See the
[models page](https://llmgateway.io/models?filters=1&imageGeneration=true) for
current prices.

---

**[SVG output docs →](https://docs.llmgateway.io/features/image-generation#svg-output)** | **[Generating SVGs with AI →](https://llmgateway.io/blog/generate-svg-with-ai)**
