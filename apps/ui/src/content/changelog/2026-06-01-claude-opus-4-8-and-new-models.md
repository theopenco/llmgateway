---
id: "50"
slug: "claude-opus-4-8-and-new-models"
date: "2026-06-01"
title: "Claude Opus 4.8 + a Wave of New Models"
summary: "Claude Opus 4.8 lands with a 1M context window, Sonnet 4.6 gets 1M context too, and Qwen3.7 Max, Grok Build 0.1, Kimi K2.6, and GLM-5.1 join the gateway."
image:
  src: "/changelog/claude-opus-4-8-and-new-models.png"
  alt: "Claude Opus 4.8 and a wave of new models on LLM Gateway"
  width: 1536
  height: 1024
---

The model catalog just got a lot deeper. Anthropic's new flagship is live, two Claude models now run on a million-token context, and four more models from across the ecosystem are one API call away.

## Claude Opus 4.8

Anthropic's most capable model is available now — with a **1M token context window** out of the box.

```bash
anthropic/claude-opus-4-8
```

- **1,000,000** token context, up to **128K** output tokens
- Adaptive reasoning, vision, tool use, structured JSON output, and web search
- **$5 / 1M** input · **$25 / 1M** output

## Sonnet 4.6 Now Runs on 1M Context

`anthropic/claude-sonnet-4-6` now supports the full **1M token context window** — feed it entire codebases, long transcripts, or large document sets without chunking.

```bash
anthropic/claude-sonnet-4-6
```

## More Models, More Providers

### Qwen3.7 Max

Alibaba's largest Qwen yet, with a **1M context window** and reasoning built in.

```bash
alibaba/qwen3.7-max
```

- **1M** context · **$2.50 / 1M** input · **$7.50 / 1M** output
- Available in **Singapore** and **cn-beijing** regions — pick the one closest to your users

### Grok Build 0.1

xAI's fast coding model, tuned for agentic software-engineering workflows.

```bash
xai/grok-build-0.1
```

- **256K** context · **$1 / 1M** input · **$2 / 1M** output

### Kimi K2.6

Moonshot's latest, served through CanopyWave.

```bash
canopywave/kimi-k2.6
```

- **262K** context · **$0.50 / 1M** input · **$2.80 / 1M** output

### GLM-5.1

Z.ai's GLM-5.1, now available via EmberCloud.

```bash
embercloud/glm-5.1
```

- **203K** context · **$0.93 / 1M** input · **$2.93 / 1M** output

---

Every model above works through the same API key, the same OpenAI-compatible endpoint, and shows up in your usage and cost dashboards automatically. Switch between them by changing one string.

**[Browse all models →](https://llmgateway.io/models)** | **[Read the docs →](https://docs.llmgateway.io)**
