---
id: "118"
slug: "lounge-new-video-models"
date: "2026-10-29"
title: "Six New Video Models in Lounge"
summary: "Video Studio in Lounge now runs FLUX 3 Max on fal, KLING v3.0 Pro, Gemini Omni 1.1 Flash, VEED Fabric 1.0, MiniMax H3 Max and Grok Imagine Video 1.5 Lite, from 2-cent-per-second drafts to 1080p shots with sound and lip-synced talking video. Finished videos now show up the moment they are ready, without a reload."
tags: ["lounge"]
image:
  src: "/changelog/lounge-new-video-models.png"
  alt: "Lounge Video Studio with six new video models: FLUX 3 Max, KLING v3.0 Pro, Gemini Omni 1.1 Flash, VEED Fabric 1.0, MiniMax H3 Max and Grok Imagine Video 1.5 Lite"
  width: 1536
  height: 1024
---

Picking a video model usually means a trade between price, length, resolution and sound, and the right answer changes from one shot to the next. **Video Studio** in Lounge now carries six more models (seven, counting Fabric Fast), so a cheap draft, a 20-second hero shot and a talking presenter all start from the same prompt box at [lounge.llmgateway.io/video](https://lounge.llmgateway.io/video).

## The new models

| Model                           | Provider         | Inputs in Video Studio                                | Length               | Price per second                 |
| ------------------------------- | ---------------- | ----------------------------------------------------- | -------------------- | -------------------------------- |
| **FLUX 3 Max**                  | fal              | Text, first and last frame                            | 5–20 s               | $0.17 at 720p, $0.29 at 1080p    |
| **KLING v3.0 Pro**              | AtlasCloud       | Text, first and last frame                            | 5 or 10 s            | $0.112 silent, $0.168 with audio |
| **Gemini Omni 1.1 Flash**       | Google AI Studio | Text, first and last frame, reference images & videos | 3–10 s               | $0.034 at 360p to $0.304 at 4K   |
| **VEED Fabric 1.0**             | AtlasCloud       | One portrait image and one speech clip                | Follows audio        | $0.088 at 480p, $0.165 at 720p   |
| **VEED Fabric 1.0 Fast**        | AtlasCloud       | One portrait image and one speech clip                | Follows audio        | $0.11 at 480p, $0.22 at 720p     |
| **MiniMax H3 Max**              | MiniMax          | Text, first and last frame                            | 5–15 s               | $0.05 at 480p, $0.08 at 768p     |
| **Grok Imagine Video 1.5 Lite** | xAI              | Text, first frame                                     | 6, 8, 10, 12 or 15 s | $0.02 at 480p, $0.03 at 720p     |

The controls follow the selected model: only its resolutions, aspect ratios and lengths are offered, and the estimated cost updates next to **Generate**. Turn on comparison mode to run the same prompt on up to three of them side by side.

## What each one is for

- **FLUX 3 Max** renders up to 20 seconds at 1080p, with or without audio. Its **Prompt reasoning** setting (low or high) sets how much reasoning the model spends on your prompt before rendering; it does not change resolution or visual quality.
- **KLING v3.0 Pro** renders 1080p only, in 16:9 or 9:16, and charges less when you switch audio off.
- **Gemini Omni 1.1 Flash** always generates sound and goes from 360p to 4K. Up to three reference videos steer the motion and framing of the result.
- **VEED Fabric 1.0** turns a still portrait and a voice recording into a lip-synced talking video. The video runs as long as the audio, up to five minutes. **Fabric 1.0 Fast** is VEED's fast variant of the same model, priced as in the table.
- **MiniMax H3 Max** and **Grok Imagine Video 1.5 Lite** are the low-cost options for drafts and storyboards, both with native audio.

## Results that show up on their own

Some providers, fal among them, report no progress while a video renders. Video Studio now shows how long the job has been running instead of a bar stuck at 0%. When the job finishes, the video appears in place: a finished job whose file is still being prepared is no longer handed to the player early, a player that misses its first load retries on its own, and a tab you come back to checks for results right away instead of waiting for the next throttled poll.

Every model is also available through the API with the same parameters:

```bash
curl -X POST "https://api.llmgateway.io/v1/videos" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "flux-3-max",
    "prompt": "A paper plane glides over a rainy neon city at night, cinematic",
    "seconds": 8,
    "size": "1920x1080",
    "audio": true
  }'
```

Video Studio draws on your organization's credits at each model's catalogue price.

---

**[Video Studio docs →](https://docs.llmgateway.io/learn/playground-video)** | **[Open Video Studio →](https://lounge.llmgateway.io/video)**
