---
id: "93"
slug: "ai-sdk-7-provider-video-generation"
date: "2026-09-05"
title: "AI SDK 7 Provider with Video Generation"
summary: "@llmgateway/ai-sdk-provider 4.0 targets Vercel AI SDK 7 and adds llmgateway.video() for experimental_generateVideo: the provider submits a gateway video job, the SDK polls it, and you get the MP4 bytes back, with image-to-video, first and last frames, reference inputs, and audio control. Stay on 3.x for AI SDK 6."
image:
  src: "/changelog/ai-sdk-7-provider-video-generation.png"
  alt: "A glowing film clapperboard with a play-button lens on a circuit board chip, surrounded by film reels, a video camera, and code brackets"
  width: 1536
  height: 1024
---

Generating video through the gateway from an AI SDK app meant dropping out of the SDK: call `POST /v1/videos` yourself, poll the job, fetch the content endpoint, and stitch the bytes back into your code. **Version 4.0 of `@llmgateway/ai-sdk-provider`** targets AI SDK 7 and brings video into the SDK's own API, next to text, images, tools, and structured output.

## Generate Video in the SDK

```bash
pnpm add @llmgateway/ai-sdk-provider@4 ai zod
```

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
});

await writeFile("video.mp4", video.uint8Array);
```

The provider creates the job, the SDK polls its status, and the result is downloaded through the authenticated content endpoint. Failed, canceled, and expired jobs throw. The job ID is available in `providerMetadata.llmgateway.videos`, and `experimental_startVideo` plus `experimental_getVideoStatus` let another process pick a job up later. Model IDs are plain strings, so new gateway video models work without a provider update.

## Every Gateway Video Input

| SDK option                   | Gateway field                            |
| ---------------------------- | ---------------------------------------- |
| `duration`                   | `seconds` (required)                     |
| `resolution`                 | `size`, which also sets the aspect ratio |
| `generateAudio`              | `audio`                                  |
| `prompt.image`               | `image` for image-to-video               |
| `frameImages`                | `image` and `last_frame`                 |
| `inputReferences`            | `reference_images`, `reference_videos`   |
| `n`                          | One independent job per video            |
| `providerOptions.llmgateway` | Any other field, such as callback URLs   |

`aspectRatio`, `fps`, and `seed` are not forwarded and produce unsupported-setting warnings instead of silent drops. Supported sizes and durations depend on the model; the gateway validates them and returns `400` for combinations a provider cannot serve.

## What Changed Under the Hood

Chat, completion, and image models now implement the SDK's v4 interfaces, including tagged file inputs and outputs, and completion models get corrected default tool-choice handling and text-stream lifecycle events. The package ships as ESM with shared runtime classes across its entry points.

**Breaking:** 4.x requires Node.js 22 or later, ESM imports, and AI SDK 7.0.93 or later. Projects on AI SDK 6 should stay on `@llmgateway/ai-sdk-provider@3`.

---

**[AI SDK docs →](https://docs.llmgateway.io/developers/ai-sdk)** | **[Video generation API →](https://docs.llmgateway.io/features/video-generation)**
