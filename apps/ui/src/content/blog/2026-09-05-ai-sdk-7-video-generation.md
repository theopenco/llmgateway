---
id: "blog-ai-sdk-7-video-generation"
slug: "ai-sdk-7-video-generation"
date: "2026-09-05"
title: "Video Generation With the Vercel AI SDK 7 and LLM Gateway"
summary: "AI SDK video generation now works through LLM Gateway: version 4 of @llmgateway/ai-sdk-provider targets AI SDK 7 and adds llmgateway.video() for experimental_generateVideo. Generate Veo, Seedance, and KLING clips with one API key, including image-to-video, first and last frames, references, and long-running jobs."
categories: ["Integrations"]
faqs:
  - question: "How do I generate video with the Vercel AI SDK?"
    answer: "Install @llmgateway/ai-sdk-provider@4 with ai and zod, then call experimental_generateVideo with model: llmgateway.video('seedance-2-0'), a prompt, a duration, and a resolution. The provider submits a gateway video job, the SDK polls it, and the result contains the MP4 bytes in video.uint8Array."
  - question: "Which video models work with the LLM Gateway AI SDK provider?"
    answer: "Any video-capable model on LLM Gateway, including Google's Veo 3.1, ByteDance's Seedance 2.5, 2.0, 2.0 Fast, 2.0 Mini, and 1.5 Pro, and KLING v3.0 and v3.0 Turbo. Model IDs are plain strings, so new gateway video models work without a provider update."
  - question: "Does the AI SDK 7 provider still support AI SDK 6?"
    answer: "No. Provider 4.x requires AI SDK 7.0.93 or later, Node.js 22 or later, and ESM imports. Projects on AI SDK 6 should stay on @llmgateway/ai-sdk-provider@3, which keeps receiving text and image support."
image:
  src: "/blog/ai-sdk-7-video-generation.png"
  alt: "A glowing film clapperboard with a strip of film curling off it on a circuit board chip, surrounded by video cameras, film reels, and code brackets"
  width: 1536
  height: 1024
---

The Vercel AI SDK made text, tools, and images feel like one API. Video was the holdout: if you wanted a Veo or Seedance clip from an AI SDK app that routed through **LLM Gateway**, you left the SDK, posted to `/v1/videos` yourself, polled the job, downloaded the content, and glued the bytes back in. **AI SDK video generation** through the gateway now takes one call.

Version 4 of `@llmgateway/ai-sdk-provider` targets AI SDK 7 and implements the SDK's native video model interface. Same package, same API key, and every video-capable model on the gateway.

## Install the AI SDK 7 provider

```bash
pnpm add @llmgateway/ai-sdk-provider@4 ai zod
```

Create an API key in the [LLM Gateway dashboard](https://llmgateway.io/dashboard) and export it as `LLM_GATEWAY_API_KEY`. The default `llmgateway` instance reads it from the environment; `createLLMGateway({ apiKey, baseURL })` covers custom keys and self-hosted gateways.

## Generate a video

```ts
import { writeFile } from "node:fs/promises";
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { experimental_generateVideo as generateVideo } from "ai";

const { video } = await generateVideo({
  model: llmgateway.video("seedance-2-0"),
  prompt: "A cinematic aerial view of ocean waves at sunrise",
  duration: 8,
  resolution: "1280x720",
  poll: { intervalMs: 5_000, timeoutMs: 600_000 },
  abortSignal: AbortSignal.timeout(600_000),
});

await writeFile("video.mp4", video.uint8Array);
```

Behind that call the provider creates a gateway video job, the SDK polls its status with your `poll` settings, and the finished file is downloaded through the authenticated content endpoint. The result carries the bytes, the media type, response metadata, and the job ID under `providerMetadata.llmgateway.videos`. Failed, canceled, and expired jobs throw instead of returning an empty result.

`duration` and a text prompt are required. `resolution` maps to the gateway's `size` and also decides the aspect ratio: `1280x720` is landscape, `720x1280` is portrait. `generateAudio` maps to `audio`. The gateway validates the combination and returns `400` for a size or duration the selected model cannot serve.

## Image-to-video, frames, and references

The SDK's richer prompt shapes map onto the gateway's video inputs, so the same code covers the different ways models accept guidance:

```ts
const { video } = await generateVideo({
  model: llmgateway.video("seedance-2-0"),
  prompt: {
    image: "https://example.com/first-frame.png",
    text: "Animate the scene with gentle camera motion",
  },
  duration: 5,
  resolution: "1280x720",
  generateAudio: false,
});
```

| SDK option                   | Gateway field                             |
| ---------------------------- | ----------------------------------------- |
| `prompt.image`               | `image` (first frame)                     |
| `frameImages`                | `image` and `last_frame`                  |
| `inputReferences`            | `reference_images` and `reference_videos` |
| `n`                          | One independent job per requested video   |
| `providerOptions.llmgateway` | Any other field, such as reference audio  |

Images can be URLs, base64 data, or raw bytes; video references must be HTTPS URLs with a video media type. `aspectRatio`, `fps`, and `seed` are not forwarded and surface as unsupported-setting warnings rather than being dropped silently. Model-specific rules, such as which models accept frames or references, are enforced by the gateway and documented in the [video generation API reference](https://docs.llmgateway.io/features/video-generation).

## Long-running jobs

Video jobs take minutes, and a serverless function may not want to hold the connection. The provider supports the SDK's `experimental_startVideo` and `experimental_getVideoStatus`, so one process can submit the job and another can check on it later using the same model and job ID. Aborting stops local polling; the gateway job may keep running. For push-style completion, pass the gateway's `callback_url` and `callback_secret` through `providerOptions.llmgateway` and the gateway signs a webhook when the job finishes.

## Picking a model

Model IDs are strings, so anything on the [models page with the video filter](https://llmgateway.io/models?filters=1&videoGeneration=true) works. The current families and what they accept:

| Model family     | Provider        | Resolutions       | Durations        |
| ---------------- | --------------- | ----------------- | ---------------- |
| Veo 3.1          | `google-vertex` | 720p, 1080p, 4K   | 4, 6, 8, or 10 s |
| Seedance 2.5     | `bytedance`     | 480p, 720p, 1080p | 4–30 s           |
| Seedance 2.0     | `bytedance`     | 720p, 1080p       | 4–15 s           |
| Seedance 1.5 Pro | `bytedance`     | 720p, 1080p       | 5 or 10 s        |
| KLING v3.0       | `atlascloud`    | 720p, 1080p, 4K   | 5 or 10 s        |

Frame and reference inputs are supported on Seedance 2.x and KLING v3.0; Veo 3.1 accepts first and last frames. The docs table lists the exact `size` strings per model.

## What else changed in version 4

Chat, completion, and image models now implement AI SDK 7's v4 model interfaces, including tagged file inputs and outputs. Completion models get corrected default tool-choice handling and proper text-stream lifecycle events. The package ships as ESM with shared runtime classes and type declarations across its entry points, and the test suite runs the same 150 cases in Node and Edge.

**Migrating:** version 4 requires Node.js 22 or later, ESM imports, and AI SDK 7.0.93 or later. Follow the [AI SDK 7 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0) for the SDK side; the provider's own surface for text and images is unchanged. Stay on `@llmgateway/ai-sdk-provider@3` if you are on AI SDK 6.

## Getting started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** and generate your first clip with the code above
- **[Read the AI SDK docs page](https://docs.llmgateway.io/developers/ai-sdk)** for text, tools, structured output, images, and video in one place
- **[Generating images with the AI SDK](https://docs.llmgateway.io/developers/ai-sdk-images)** uses the same provider with `llmgateway.image()`

<BlogCta variant="gateway" location="bottom" />
