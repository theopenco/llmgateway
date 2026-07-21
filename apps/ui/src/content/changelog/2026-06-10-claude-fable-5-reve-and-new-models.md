---
id: "55"
slug: "claude-fable-5-reve-and-new-models"
date: "2026-06-10"
title: "Claude Fable 5, Reve Image Gen & More New Models"
summary: "Anthropic's next-generation Claude Fable 5 lands with 1M context, Reve joins as a new image provider, xAI's Grok Imagine Video 1.5 turns images into 15-second clips, and NVIDIA's Nemotron 3 Ultra 550B arrives."
image:
  src: "/changelog/claude-fable-5-reve-and-new-models.png"
  alt: "Claude Fable 5, Reve, Grok Imagine Video and Nemotron 3 Ultra joining LLM Gateway"
  width: 1024
  height: 1024
---

Four new arrivals this week — a next-generation frontier model, a new image provider, an image-to-video model, and NVIDIA's biggest open model yet.

## Claude Fable 5

Anthropic's next-generation model for knowledge work and coding is live:

```bash
anthropic/claude-fable-5
```

- **1,000,000** token context, up to **128K** output tokens
- Adaptive reasoning, vision, tool use, and structured JSON output
- Prompt caching with 5-minute and 1-hour cache writes
- **$10 / 1M** input · **$50 / 1M** output · **$1 / 1M** cached reads

## Reve Create — New Image Provider

[Reve](https://llmgateway.io/models?filters=1&imageGeneration=true) joins the gateway as a new image generation provider. `reve/reve-create` produces high-quality images with **native 4K resolution** at a flat **$0.024 per image** — works in the [Image Studio](https://chat.llmgateway.io/image) and through `/v1/chat/completions` like every other image model.

## Grok Imagine Video 1.5 Preview

xAI's image-to-video model is available as `xai/grok-imagine-video-1-5-preview`:

- Turns an input image into video clips of **6 to 15 seconds**, with audio
- Resolutions from 480p up to 1080p
- **$0.08/s** at 480p, **$0.14/s** at 720p+, plus $0.01 per input image
- Try it in the [Video Studio](https://chat.llmgateway.io/video)

## Nemotron 3 Ultra 550B

NVIDIA's most capable open model — 550B parameters for complex reasoning, coding, and multimodal tasks:

```bash
deepinfra/nemotron-3-ultra-550b
```

- **262K** context with vision, tools, and JSON output
- **$0.50 / 1M** input · **$2.50 / 1M** output · cached reads at $0.15 / 1M

---

**[Browse all models →](https://llmgateway.io/models)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
