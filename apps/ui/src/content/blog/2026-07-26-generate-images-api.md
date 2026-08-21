---
id: "blog-generate-images-api"
slug: "generate-images-api"
date: "2026-07-26"
title: "How to Generate Images with One API (2026 Guide)"
summary: "A practical AI image generation API tutorial: call gpt-image-2, Gemini, and Seedream through one OpenAI-compatible endpoint, pick sizes and quality, edit existing images, and see the exact cost of every generation."
categories: ["Guides"]
faqs:
  - question: "Which image generation models can I use through the API?"
    answer: "Every model on the [models page with the image filter](https://llmgateway.io/models?filters=1&imageGeneration=true) — including OpenAI, Google, ByteDance, Alibaba, xAI, and more — through the same endpoint. The list updates as new models ship."
  - question: "Do I need separate API keys per provider?"
    answer: "No. One LLM Gateway key covers every provider. You can bring your own provider keys for free, or use pay-as-you-go credits with a flat 5% platform fee."
  - question: "Can I generate images conversationally?"
    answer: "Yes. Multimodal models like `gemini-3-pro-image-preview` can return images through `/v1/chat/completions`, which is useful for iterative editing in a chat UI. The [image generation docs](https://docs.llmgateway.io/features/image-generation) cover the chat flow."
  - question: "Is there a way to try models before writing code?"
    answer: "The [Image Studio in Lounge](https://lounge.llmgateway.io/image) generates 1, 2, or 4 images per prompt and lets you compare models side by side."
image:
  src: "/blog/generate-images-api.png"
  alt: "A glowing image frame being generated on a circuit board, representing an AI image generation API"
  width: 1536
  height: 1024
---

Every image model ships behind a different API. OpenAI's `gpt-image-2` wants one SDK, Gemini image models another, Seedream a third — each with its own auth, parameters, and billing. If you want to compare outputs or switch models later, you rewrite your integration every time.

**LLM Gateway** solves this with one OpenAI-compatible image generation API. `POST /v1/images/generations` reaches every image model in the catalog — [browse them with the image filter](https://llmgateway.io/models?filters=1&imageGeneration=true) — with one API key and one response format.

## Generate your first image

Grab an API key from the [dashboard](https://llmgateway.io/dashboard), then:

```bash
curl -X POST "https://api.llmgateway.io/v1/images/generations" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "prompt": "A cute cat wearing a tiny top hat",
    "n": 1,
    "size": "1024x1024"
  }'
```

The response contains base64-encoded images:

```json
{
  "created": 1753500000,
  "data": [{ "b64_json": "iVBORw0KGgo..." }]
}
```

Leave `model` out (or pass `"auto"`) and the gateway picks a strong default image model for you.

## Use your existing OpenAI SDK

Because the endpoint is OpenAI-compatible, the standard client works — change the base URL and nothing else:

```ts
import OpenAI from "openai";
import { writeFileSync } from "fs";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const response = await client.images.generate({
  model: "gpt-image-2",
  prompt: "A futuristic city skyline at sunset with flying cars",
  n: 1,
  size: "1536x1024",
});

response.data.forEach((image, i) => {
  if (image.b64_json) {
    writeFileSync(`image-${i}.png`, Buffer.from(image.b64_json, "base64"));
  }
});
```

Switching from `gpt-image-2` to a Gemini or Seedream model is a one-line change to `model` — same request, same response shape.

<BlogCta variant="gateway" location="mid_article" />

## The parameters that matter

| Parameter      | What it does                                                           |
| -------------- | ---------------------------------------------------------------------- |
| `prompt`       | Required. Text description of the image                                |
| `model`        | Any image model; defaults to `auto`                                    |
| `n`            | 1–10 images per request                                                |
| `size`         | Pixel dimensions like `1024x1024` or `1536x1024`, model-dependent      |
| `quality`      | `low`, `medium`, `high`, or `auto` on models that support it           |
| `aspect_ratio` | `1:1`, `16:9`, `4:3`, … — takes precedence over `size` where supported |
| `style`        | `vivid` or `natural`                                                   |

Two model-specific notes worth knowing: `aspect_ratio` works on Gemini image models while OpenAI's `gpt-image-2` ignores it (use an exact `size` instead), and `quality` applies to `gpt-image-2`. The [image generation docs](https://docs.llmgateway.io/features/image-generation) list per-model behavior.

## Edit existing images

`POST /v1/images/edits` takes one or more input images (HTTPS URLs or base64 data URLs) plus an edit prompt:

```bash
curl -X POST "https://api.llmgateway.io/v1/images/edits" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [{ "image_url": "https://example.com/product.png" }],
    "prompt": "Place the product on a marble table with soft window light",
    "quality": "high"
  }'
```

You can control `background` (`transparent`, `opaque`, `auto`), `output_format` (`png`, `jpeg`, `webp`), and `output_compression` for the encoded result.

## Using the Vercel AI SDK

If you build with the AI SDK, the `@llmgateway/ai-sdk-provider` package supports `generateImage` directly:

```ts
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { generateImage } from "ai";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const result = await generateImage({
  model: llmgateway.image("gemini-3-pro-image-preview"),
  prompt: "A cozy cabin in a snowy mountain landscape at night",
  size: "1024x1024",
});
```

See the [AI SDK developer docs](https://docs.llmgateway.io/developers/ai-sdk-images) for chat-based image streaming with `useChat`.

## Know what every image costs

Every generation is logged with its exact cost. The [Activity page](https://docs.llmgateway.io/learn/activity) shows per-request image output costs, and the [dashboard](https://docs.llmgateway.io/learn/dashboard) rolls them up by model and project — so you can compare not just output quality across models, but price per image. Set a [spending limit on the API key](https://docs.llmgateway.io/learn/api-keys) if you want a hard cap.

---

**Get started:**

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — one key for every image model
- **[Image generation docs](https://docs.llmgateway.io/features/image-generation)** — full parameter reference
- **[How to generate videos with the API](/blog/generate-videos-api)** — the async counterpart to this guide

<BlogCta variant="gateway" location="bottom" />
