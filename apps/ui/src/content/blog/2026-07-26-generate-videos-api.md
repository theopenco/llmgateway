---
id: "blog-generate-videos-api"
slug: "generate-videos-api"
date: "2026-07-26"
title: "How to Generate AI Videos with an API"
summary: "An AI video generation API tutorial: submit async jobs to Veo, Seedance, and KLING through one OpenAI-compatible endpoint, poll or receive signed webhooks, download the MP4, and keep per-second costs visible."
categories: ["Guides"]
faqs:
  - question: "How long does AI video generation take?"
    answer: "Minutes, not seconds — depending on the model, duration, and resolution. That's why the API is asynchronous: submit, then poll or take a webhook. 4K jobs stay `in_progress` until the upscaled output is ready."
  - question: "Which video model is cheapest for prototyping?"
    answer: "Prototype on a low-priced tier like Seedance 2.0 Mini at 480p or 720p, then re-render the winning prompt on a premium model at 1080p — same request body, different `model` and `size`."
  - question: "Can I generate videos without writing code first?"
    answer: "Yes — the [Video Studio in Lounge](https://lounge.llmgateway.io/video) runs the same models with resolution, duration, and audio controls in the browser."
image:
  src: "/blog/generate-videos-api.png"
  alt: "A glowing film clapperboard rendering frames on a circuit board, representing an AI video generation API"
  width: 1536
  height: 1024
---

Video models don't respond in milliseconds — a single clip can take minutes to render, and every provider handles the waiting differently. Google Vertex uses long-running operations, ByteDance uses task polling, AtlasCloud uses prediction endpoints. Building against three job systems to compare three models is a bad afternoon.

**LLM Gateway** wraps all of them in one asynchronous, OpenAI-compatible AI video generation API: `POST /v1/videos` submits the job, `GET /v1/videos/{id}` reports progress, and `GET /v1/videos/{id}/content` streams the finished MP4 — for every video model in the catalog. Browse the current list on the [models page with the video filter](https://llmgateway.io/models?filters=1&videoGeneration=true).

## Submit a job

```bash
curl -X POST "https://api.llmgateway.io/v1/videos" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "veo-3.1-generate-preview",
    "prompt": "A cinematic aerial shot flying above a rainforest waterfall at sunrise",
    "seconds": 8,
    "size": "1920x1080"
  }'
```

The response comes back immediately with a job id:

```json
{
  "id": "v_123",
  "object": "video",
  "model": "veo-3.1-generate-preview",
  "status": "queued",
  "progress": 0,
  "created_at": 1753500000,
  "completed_at": null,
  "error": null
}
```

Three fields are required: `model`, `prompt`, and `seconds`. Optional fields include `size` (`widthxheight`), `audio` (default `true`), first/last frame images for image-to-video, and reference images, videos, or audio on models that support them. Video generation requires at least $1.00 of available organization credits before the job is submitted.

## Pick a model, duration, and resolution

Each model supports specific sizes and durations — requests outside them return a `400` instead of silently rendering something else:

| Model family      | Sizes                          | Durations   | Price (720p/1080p, with audio) |
| ----------------- | ------------------------------ | ----------- | ------------------------------ |
| Veo 3.1           | 720p, 1080p, 4K (portrait too) | 4, 6, 8, 10 | $0.40/s (1080p)                |
| Veo 3.1 Fast      | 720p, 1080p, 4K                | 4, 6, 8, 10 | $0.15/s (1080p)                |
| Seedance 2.0      | 720p, 1080p                    | 4–15        | $0.15/s / $0.34/s              |
| Seedance 2.0 Mini | 480p, 720p                     | 4–15        | $0.04/s / $0.08/s              |
| KLING v3.0        | 720p, 1080p, 4K                | 5, 10       | $0.13/s / $0.17/s              |

Billing is per second of generated video, so an 8-second 1080p Veo 3.1 clip costs about $3.20, while the same clip on Seedance 2.0 Mini at 720p costs about $0.60. The [video generation docs](https://docs.llmgateway.io/features/video-generation) carry the full per-model price and size tables.

<BlogCta variant="gateway" location="mid_article" />

## Poll for completion and download

```bash
curl "https://api.llmgateway.io/v1/videos/v_123" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY"
```

Statuses move through `queued` → `in_progress` → `completed` (or `failed`). Once complete, stream the bytes:

```bash
curl "https://api.llmgateway.io/v1/videos/v_123/content" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  --output video.mp4
```

## Skip polling with signed webhooks

Polling works, but for production the gateway can call you. Pass `callback_url` and `callback_secret` when creating the job:

```bash
curl -X POST "https://api.llmgateway.io/v1/videos" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "veo-3.1-fast-generate-preview",
    "prompt": "A slow-motion close-up of waves crashing against black volcanic rock",
    "seconds": 8,
    "callback_url": "https://example.com/webhooks/video",
    "callback_secret": "whsec_your_secret_here"
  }'
```

You get a `video.completed` or `video.failed` event with retries and exponential backoff. Every delivery is signed with HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}` so you can verify it server-side:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhook(
  body: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  secret: string,
) {
  const expected = createHmac("sha256", secret)
    .update(`${webhookId}.${webhookTimestamp}.${body}`)
    .digest("base64");

  return timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(webhookSignature.replace(/^v1,/, "")),
  );
}
```

## Image-to-video and reference-guided clips

Two more modes beyond text-to-video:

- **First/last frame**: pass `image` (and optionally `last_frame`) to animate between frames — supported on Seedance 2.0, KLING v3.0, and Veo 3.1.
- **Omni-reference (Seedance 2.0)**: pass up to three `reference_images`, `reference_videos`, and `reference_audios` to drive subject, motion, and sound; the prompt becomes a light instruction like "adapt this to show more detail".

Frame inputs and reference inputs can't be combined in one request, and reference video/audio must be HTTPS URLs the provider can fetch.

## Watch the spend

Video is the most expensive modality you'll route, so treat cost as a first-class output: every job is logged with its per-second price, the [Activity page](https://docs.llmgateway.io/learn/activity) breaks out video output costs, and [API key spending limits](https://docs.llmgateway.io/learn/api-keys) put a hard cap on how much a runaway batch job can burn.

---

**Get started:**

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — one key for every video model
- **[Video generation docs](https://docs.llmgateway.io/features/video-generation)** — sizes, durations, prices, and callbacks
- **[How to generate images with the API](/blog/generate-images-api)** — the synchronous counterpart

<BlogCta variant="gateway" location="bottom" />
