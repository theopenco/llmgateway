---
id: "54"
slug: "speech-generation-and-audio-studio"
date: "2026-06-10"
title: "Speech Generation + Audio Studio"
summary: "Text-to-speech is live: nine models from ElevenLabs, OpenAI, and Gemini behind the OpenAI-compatible /v1/audio/speech endpoint, plus a new Audio Studio in the Playground to compare voices side by side."
image:
  src: "/changelog/speech-generation-and-audio-studio.png"
  alt: "Speech generation and Audio Studio on LLM Gateway"
  width: 1024
  height: 1024
---

LLM Gateway can now talk. Text-to-speech ships today with **nine models across three providers** — all behind the same API key, billing, and logs as your chat, image, and video requests.

## The `/v1/audio/speech` Endpoint

A drop-in replacement for OpenAI's audio API — point your existing OpenAI client at the gateway and you're done:

```bash
curl -X POST "https://api.llmgateway.io/v1/audio/speech" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "eleven-multilingual-v2",
    "input": "Hello, welcome to LLM Gateway!",
    "voice": "Sarah"
  }' \
  --output speech.mp3
```

Supports `voice`, `response_format` (`mp3`, `wav`, `opus`, `aac`, `flac`, `pcm` — varies by family), style `instructions`, and `speed`. See the [speech generation docs](https://docs.llmgateway.io/features/speech-generation) for the full reference.

## ElevenLabs Joins the Gateway

A brand-new provider with four models and 20 named voices:

- **`eleven-multilingual-v2`** — most lifelike, 29 languages · $0.11 / 1K characters
- **`eleven-v3`** — most expressive, 70+ languages · $0.11 / 1K characters
- **`eleven-flash-v2-5`** — ultra-low latency, 32 languages · $0.055 / 1K characters
- **`eleven-turbo-v2-5`** — fast and balanced · $0.055 / 1K characters

They join OpenAI's `tts-1`, `tts-1-hd`, and steerable `gpt-4o-mini-tts`, plus `gemini-2.5-flash-preview-tts` and `gemini-2.5-pro-preview-tts` — **60+ prebuilt voices** in total. Browse them all on the [models page](https://llmgateway.io/models?filters=1&audioGeneration=true).

## Audio Studio

The Playground gets a third studio at `/audio`, joining Image and Video:

- **Compare mode** — generate the same script with up to 3 models in parallel and listen side by side
- **Per-model controls** — voice, output format, playback speed, and style instructions adapt to each model family
- **Org-scoped history** — every generation is saved; revisit, rename, or delete past takes
- **One-click download** straight from the player

**[Try Audio Studio →](https://lounge.llmgateway.io/audio)**

---

**[Read the announcement →](https://llmgateway.io/blog/speech-generation-and-audio-studio)** | **[Speech docs →](https://docs.llmgateway.io/features/speech-generation)**
