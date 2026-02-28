---
id: "40"
slug: "image-studio-and-more"
date: "2026-02-27"
title: "Image Studio, Image Edits API & More"
summary: "A dedicated Image Studio in the Playground for gallery-based generation with multi-model comparison, an OpenAI-compatible /v1/images/edits endpoint, and a wave of image generation improvements."
image:
  src: "/changelog/image-studio.png"
  alt: "Image Studio in the Playground comparing generations across Gemini 3.1 Flash Image, Gemini 3 Pro Image, and Qwen Image side by side"
  width: 3024
  height: 1900
---

## Image Studio

The Playground now has a dedicated **Image Studio** at `/image` — a gallery-based UI purpose-built for image generation workflows rather than conversational chat.

### Multi-Model Comparison

Toggle **Compare** mode to select up to 3 image models and generate from all of them in parallel. Results appear side by side so you can instantly evaluate quality, style, and consistency across providers.

### Gallery-First Design

- Full prompt controls: aspect ratio, resolution, pixel dimensions, and image count (1–4)
- Results appear newest-first in a scrollable gallery
- Click any image to zoom, hover to download
- Recent prompts saved in the sidebar for quick re-use
- Suggestion prompts to get started with one click

### Supported Models

Image Studio works with every image generation model on LLM Gateway, including Gemini 3.1 Flash Image, Gemini 3 Pro Image, Qwen Image, Seedream, CogView, and more.

**[Try it now](https://chat.llmgateway.io/image)**

---

## AI SDK Provider: `generateImage()` Support

Our `@llmgateway/ai-sdk-provider` now supports the Vercel AI SDK's `generateImage()` function. Use `llmgateway.image()` to get an image model:

```ts
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { generateImage } from "ai";
import { writeFileSync } from "fs";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const result = await generateImage({
  model: llmgateway.image("gemini-3-pro-image-preview"),
  prompt:
    "A cozy cabin in a snowy mountain landscape at night with aurora borealis",
  size: "1024x1024",
  n: 1,
});

result.images.forEach((image, i) => {
  const buf = Buffer.from(image.base64, "base64");
  writeFileSync(`image-${i}.png`, buf);
});
```

---

## OpenAI-Compatible Image APIs

### /v1/images/generations

A fully OpenAI-compatible endpoint for image generation. Use the same request format you already know:

```bash
curl -X POST "https://api.llmgateway.io/v1/images/generations" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "prompt": "A futuristic city at sunset",
    "n": 1,
    "size": "1024x1024"
  }'
```

### /v1/images/edits

Edit existing images with a new dedicated endpoint — send an image and a prompt describing the changes you want:

```bash
curl -X POST "https://api.llmgateway.io/v1/images/edits" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -F "model=gemini-3-pro-image-preview" \
  -F "prompt=Make it nighttime with neon lights" \
  -F "image=@photo.png"
```

Both endpoints support the `aspect_ratio` parameter for controlling output dimensions.

**[Read the full image generation docs](https://docs.llmgateway.io/features/image-generation)** for all parameters, model-specific configuration, and more examples.

---

## Gemini 3.1 Flash Image Preview

Added **Gemini 3.1 Flash Image Preview** — Google's latest fast image generation model with support for 0.5K, 1K, 2K, and 4K resolutions.

---

## More Improvements

- **Image generation in chat**: Smarter detection of vision vs image generation mode — attaching images now correctly triggers vision, while text-only prompts trigger image generation
- **Aspect ratio support**: Added `aspect_ratio` parameter across all image generation endpoints
- **URL-based images**: Image generation responses now correctly handle URL-based image references
- **IAM enforcement**: `deny_providers` rules are now correctly enforced during provider routing
- **Google AI schema fix**: Unsupported schema properties are now stripped before forwarding to Google AI
