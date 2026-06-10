---
id: blog-speech-generation-and-audio-studio
slug: speech-generation-and-audio-studio
date: 2026-06-10
title: "Speech Generation Is Live: ElevenLabs, OpenAI & Gemini TTS Through One API"
summary: "Nine text-to-speech models from ElevenLabs, OpenAI, and Google are now one OpenAI-compatible API call away — plus a new Audio Studio in the Playground to compare voices and models side by side."
categories: ["Announcements"]
image:
  src: "/blog/speech-generation-and-audio-studio.png"
  alt: "Sound waves flowing out of a single API endpoint into multiple speech models"
  width: 1024
  height: 1024
---

Adding voice to your app used to mean picking one TTS vendor, learning their SDK, and managing yet another API key and invoice. Today that's one decision lighter: **LLM Gateway now supports speech generation** through the OpenAI-compatible **`/v1/audio/speech`** endpoint — with models from **ElevenLabs, OpenAI, and Google Gemini** behind the same key, billing, and logs you already use for chat, images, and video.

And if you'd rather hear the voices before writing a line of code, the new **[Audio Studio](https://chat.llmgateway.io/audio)** in the Playground lets you generate speech from up to three models side by side.

## One endpoint, nine models, 60+ voices

The endpoint is a drop-in replacement for OpenAI's audio API. If you've used `openai.audio.speech.create()`, you already know how it works — point the base URL at LLM Gateway and switch models freely:

```ts
import OpenAI from "openai";
import { writeFileSync } from "fs";

const openai = new OpenAI({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
  baseURL: "https://api.llmgateway.io/v1",
});

const response = await openai.audio.speech.create({
  model: "eleven-multilingual-v2",
  voice: "Sarah",
  input: "Hello, welcome to LLM Gateway!",
});

writeFileSync("speech.mp3", Buffer.from(await response.arrayBuffer()));
```

Or with curl:

```bash
curl -X POST "https://api.llmgateway.io/v1/audio/speech" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash-preview-tts",
    "input": "Hello, welcome to LLM Gateway!",
    "voice": "Kore"
  }' \
  --output speech.wav
```

## The lineup

| Model                          | Best for                                         | Pricing                                  |
| ------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| `eleven-multilingual-v2`       | Most lifelike voices, rich emotion, 29 languages | $0.11 / 1K characters                    |
| `eleven-v3`                    | Most expressive delivery, 70+ languages          | $0.11 / 1K characters                    |
| `eleven-flash-v2-5`            | Ultra-low latency, real-time use, 32 languages   | $0.055 / 1K characters                   |
| `eleven-turbo-v2-5`            | Fast and balanced, 32 languages                  | $0.055 / 1K characters                   |
| `gpt-4o-mini-tts`              | Steerable delivery via `instructions`            | $0.60 / 1M input + $12 / 1M audio tokens |
| `tts-1`                        | Real-time OpenAI TTS                             | $15 / 1M characters                      |
| `tts-1-hd`                     | Higher-quality OpenAI TTS                        | $30 / 1M characters                      |
| `gemini-2.5-flash-preview-tts` | Natural, controllable speech at low cost         | $0.50 / 1M input + $10 / 1M audio tokens |
| `gemini-2.5-pro-preview-tts`   | Highest-quality Gemini speech                    | $1 / 1M input + $20 / 1M audio tokens    |

Between them you get **60+ prebuilt voices**: 20 named ElevenLabs voices (`Sarah`, `Roger`, `Charlotte`, `Brian`, …), 30 Gemini voices (`Kore`, `Puck`, `Zephyr`, `Charon`, …), and OpenAI's catalog (`alloy`, `ash`, `coral`, `nova`, `verse`, …).

Browse the full list with live pricing on the [models page](https://llmgateway.io/models?filters=1&audioGeneration=true).

## Control the delivery

Beyond `model`, `input`, and `voice`, the endpoint accepts:

- **`response_format`** — `mp3`, `wav`, `opus`, `aac`, `flac`, or raw `pcm`, depending on the model family
- **`instructions`** — a style directive like `"Speak like a calm narrator"` (steerable models such as `gpt-4o-mini-tts` and the Gemini TTS models shine here)
- **`speed`** — playback speed on OpenAI models

Full parameter reference, format support per family, and billing details are in the [speech generation docs](https://docs.llmgateway.io/features/speech-generation).

## Audio Studio: hear it before you ship it

Picking a voice from a table is hopeless — you need to listen. The new **Audio Studio** at [chat.llmgateway.io/audio](https://chat.llmgateway.io/audio) joins the Image and Video studios in the Playground:

- **Compare mode** — run the same script through up to **3 models in parallel** and listen side by side
- **Per-model controls** — voice picker, output format, playback speed, and style instructions adapt to whatever each model supports
- **History** — every generation is saved per organization, so you can revisit, rename, or re-run earlier takes
- **One-click download** — pull the audio file straight from the player

Type a sentence, pick `eleven-v3`, `gpt-4o-mini-tts`, and `gemini-2.5-pro-preview-tts`, and you'll know within seconds which voice fits your product.

## Why route TTS through the gateway?

The same reasons you route chat through it:

- **One API key** for every provider — no separate ElevenLabs, OpenAI, and Google accounts to wire up
- **Unified billing** — speech usage lands in the same credit balance and cost analytics as everything else, with per-request cost in your logs
- **Bring your own keys** if you have negotiated provider rates, or use gateway credits and skip provider signups entirely
- **One integration** — when the next great TTS model ships, it's a one-line model string change

One note: streaming speech output isn't supported yet — the endpoint returns the complete audio file in a single response. Low-latency chunked output is on the roadmap.

## Start talking

- **[Open Audio Studio →](https://chat.llmgateway.io/audio)** — hear the models, no code required
- **[Read the docs →](https://docs.llmgateway.io/features/speech-generation)** — parameters, formats, and examples
- **[Browse speech models →](https://llmgateway.io/models?filters=1&audioGeneration=true)** — live pricing and capabilities
- **[Get your API key →](https://llmgateway.io/dashboard)** — and make your first request in under a minute
