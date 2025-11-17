---
id: "31"
slug: "sherlock-stealth-models"
date: "2025-11-17"
title: "Sherlock: Two New Stealth Alpha Models"
summary: "Introducing Sherlock Dash Alpha and Sherlock Think Alpha - free stealth models with 1.8M context, reasoning, vision, and advanced capabilities."
image:
  src: "/changelog/sherlock-stealth-models.png"
  alt: "Sherlock: Two New Stealth Alpha Models"
  width: 1768
  height: 677
---

We're excited to introduce two new **stealth models** from **Sherlock** - completely free with massive context windows and advanced capabilities!

## 🎯 New Models Available

### **Sherlock Dash Alpha** - Fast Reasoning Model

**Model ID**: `sherlock/sherlock-dash-alpha`

**Context Window**: 1,800,000 tokens (1.8M)

**Pricing**: **FREE** ($0.00 per 1M tokens)

**Stability**: STABLE

Lightning-fast responses with reasoning, vision, and tool calling capabilities

### **Sherlock Think Alpha** - Deep Reasoning Model

**Model ID**: `sherlock/sherlock-think-alpha`

**Context Window**: 1,800,000 tokens (1.8M)

**Pricing**: **FREE** ($0.00 per 1M tokens)

**Stability**: STABLE

Advanced reasoning model optimized for complex problem-solving tasks

## ✨ Features

Both models come with comprehensive capabilities:

✅ **Streaming** - Real-time response streaming

✅ **Vision** - Image understanding and analysis

✅ **Tools** - Function calling support

✅ **Reasoning** - Advanced chain-of-thought capabilities

✅ **JSON Output** - Structured output mode

## 🚀 Getting Started

Use these models just like any other model in our gateway:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sherlock/sherlock-dash-alpha",
    "messages": [{"role": "user", "content": "Explain quantum computing"}]
  }'
```

## 🎁 Why These Models Stand Out

- **Completely Free**: No costs for input or output tokens
- **Massive Context**: 1.8M token context window for complex tasks
- **Full Feature Set**: All capabilities included
- **Production Ready**: Marked as STABLE for reliable use

---

**[Try in Playground](https://chat.llmgateway.io/?model=sherlock/sherlock-dash-alpha)** 🚀

**[Get started now](/signup)** 🚀
