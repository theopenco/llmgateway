---
id: "73"
slug: "deepseek-v4-flash-0731"
date: "2026-07-31"
title: "DeepSeek V4 Flash (0731) Now Available"
summary: "DeepSeek's July update to V4 Flash is live on LLM Gateway from day one: $0.14/M input, $0.28/M output, and cache reads at just $0.0028/M, with a 1M-token context window, reasoning, and tool calling."
image:
  src: "/changelog/deepseek-v4-flash-0731.png"
  alt: "Glossy 3D DeepSeek whale on a glowing circuit board chip, announcing DeepSeek V4 Flash (0731) on LLM Gateway"
  width: 1536
  height: 1024
---

Fast-and-cheap usually means falling behind the frontier. **DeepSeek V4 Flash (0731)**, released today, ships DeepSeek's July round of improvements at the same price point that made V4 Flash a workhorse — and it's available on LLM Gateway from day one.

## Pricing

| Model                                                                           | Input / 1M | Cached input / 1M | Output / 1M |
| ------------------------------------------------------------------------------- | ---------- | ----------------- | ----------- |
| [`deepseek-v4-flash-0731`](https://llmgateway.io/models/deepseek-v4-flash-0731) | $0.14      | $0.0028           | $0.28       |

The cache read rate is the headline: at $0.0028 per 1M tokens, cached input costs 2% of the base rate. Agent loops and long-running chats that resend the same context on every turn get billed almost nothing for it.

## What You Get

- **Context window**: 1,050,000 tokens, with 393,216 max output tokens
- **Reasoning** with selectable effort (`none`, `high`, `max`)
- Tool calling, structured outputs, and streaming

The dated ID pins this exact snapshot, so behavior won't shift under you when DeepSeek ships the next update. The undated `deepseek-v4-flash` keeps working as before.

## Getting Started

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-v4-flash-0731",
    "messages": [{"role": "user", "content": "Hello DeepSeek!"}]
  }'
```

Available on all plans.

---

**[Browse the models →](https://llmgateway.io/models)** | **[Quick start →](https://docs.llmgateway.io)**
