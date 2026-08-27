---
id: "blog-generate-audio-api"
slug: "generate-audio-api"
date: "2026-07-26"
title: "How to Generate Audio with a Text-to-Speech API"
summary: "A text-to-speech API tutorial: synthesize speech with ElevenLabs, OpenAI, Gemini, and Qwen voices through one OpenAI-compatible endpoint, choose voices and formats, steer delivery with instructions, and track the cost of every clip."
categories: ["Guides"]
faqs:
  - question: "Which text-to-speech models are available through the API?"
    answer: "Everything on the [models page with the audio filter](https://llmgateway.io/models?filters=1&audioGeneration=true) — spanning ElevenLabs, OpenAI, Google, and Alibaba voices — through one endpoint. The catalog updates as providers ship new models."
  - question: "Can I stream the audio as it generates?"
    answer: "Not yet. The endpoint returns the complete audio file in a single response; there is no chunked or SSE streaming output for now."
  - question: "How do I pick a voice without writing code?"
    answer: "Use the [Audio Studio in Lounge](https://lounge.llmgateway.io/audio) — it generates speech from up to three models side by side with per-model voice, format, and speed controls."
image:
  src: "/blog/generate-audio-api.png"
  alt: "A glowing waveform and speaker on a circuit board, representing a text-to-speech API"
  width: 1536
  height: 1024
---

Text-to-speech quality has jumped, but the APIs haven't converged: ElevenLabs has its own SDK and voice IDs, Gemini returns raw PCM, OpenAI expects its own client. Comparing voices across providers means three integrations before you've heard a single sentence.

**LLM Gateway** puts every speech model behind one OpenAI-compatible text-to-speech API: `POST /v1/audio/speech`. One key, one request shape, and the full catalog of TTS models — browse them on the [models page with the audio filter](https://llmgateway.io/models?filters=1&audioGeneration=true).

## Generate your first clip

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

The response body is the audio file itself — no base64 decoding step.

## Use your existing OpenAI SDK

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

Swapping providers is a change to `model` and `voice` — the request stays identical, which makes A/B testing voices across providers a loop instead of a project.

<BlogCta variant="gateway" location="mid_article" />

## Voices, formats, and delivery style

Every provider ships its own voice roster, and the gateway defaults sensibly per model family (`Kore` on Gemini, `alloy` on OpenAI, `Sarah` on ElevenLabs). Three parameters shape the output:

- **`voice`** — a prebuilt voice name; ElevenLabs also accepts raw voice IDs directly.
- **`response_format`** — `mp3`, `wav`, `pcm`, `opus`, `aac`, or `flac` depending on the model. Gemini models produce PCM, which the gateway wraps in a WAV container by default; formats like `mp3` are available on OpenAI models.
- **`instructions`** — a style directive prepended to the input, like `"Say cheerfully"` or `"Speak slowly, like narrating a documentary"`.

```bash
curl -X POST "https://api.llmgateway.io/v1/audio/speech" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini-tts",
    "input": "Your order has shipped and will arrive Tuesday.",
    "voice": "nova",
    "instructions": "Warm, upbeat customer-support tone",
    "response_format": "mp3"
  }' \
  --output update.mp3
```

The full per-model matrix of voices and formats lives in the [speech generation docs](https://docs.llmgateway.io/features/speech-generation).

## Going the other way: transcription

The same gateway also exposes `POST /v1/audio/transcriptions` for speech-to-text, with `multipart/form-data` file upload or a URL, optional diarization, and key-term boosting. See the [transcription docs](https://docs.llmgateway.io/features/transcription) — combined with TTS you can build full voice loops through one API.

## What does a clip cost?

Billing varies by model family: some models bill on token usage reported by the provider, others on input character count. Either way the gateway logs each request with its exact cost, visible per request on the [Activity page](https://docs.llmgateway.io/learn/activity) and aggregated in your [usage dashboards](https://docs.llmgateway.io/learn/usage-metrics). Per-model pricing is on the [models page](https://llmgateway.io/models?filters=1&audioGeneration=true), and [API key spend limits](https://docs.llmgateway.io/learn/api-keys) cap the blast radius of batch narration jobs.

---

**Get started:**

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — one key for every TTS voice
- **[Speech generation docs](https://docs.llmgateway.io/features/speech-generation)** — voices, formats, and parameters
- **[How to track usage and spend with the API](/blog/track-llm-usage-spend-api)** — keep those narration jobs on budget

<BlogCta variant="gateway" location="bottom" />
