---
id: "30"
slug: "canopywave-kimi-k2-thinking-discount"
date: "2025-11-11"
title: "CanopyWave: 75% Off Kimi K2 Thinking"
summary: "CanopyWave brings Kimi K2 Thinking to LLM Gateway with an exclusive 75% discount."
image:
  src: "/changelog/canopywave75-off-kimi-k2.png"
  alt: "CanopyWave: 75% Off Kimi K2 Thinking"
  width: 1768
  height: 677
---

We're excited to announce Kimi K2 Thinking from **CanopyWave** with an exclusive **75% discount**

## **Kimi-K2-Thinking** - Advanced Model with Reasoning

**Model ID**: `canopywave/kimi-k2-thinking`

**Context Window**: 262,144 tokens (262.1K)

**Pricing**: ~~$0.40~~ **$0.12** per 1M input tokens / ~~$2~~ **$0.50** per 1M output tokens (75% off)

Enhanced reasoning and tool calling capabilities

## 🚀 Getting Started

All models support streaming, tool calling, and JSON output mode:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "canopywave/kimi-k2-thinking",
    "messages": [{"role": "user", "content": "Write a Python function"}]
  }'
```

---

**[Try it now in the Playground](https://chat.llmgateway.io/?model=canopywave/kimi-k2-thinking)** 🚀

**[Get started now](/signup)** 🚀
