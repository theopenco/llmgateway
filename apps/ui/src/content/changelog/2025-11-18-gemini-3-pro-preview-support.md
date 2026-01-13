---
id: "32"
slug: "gemini-3-pro-preview-support"
date: "2025-11-18"
title: "Gemini 3 Pro Preview: 20% Off Launch Discount"
summary: "Google's latest Gemini 3 Pro Preview is now available with an exclusive 20% launch discount, featuring 1M context window and prompt caching."
image:
  src: "/changelog/gemini-3-pro-preview.png"
  alt: "Gemini 3 Pro Preview: 20% Off Launch Discount"
  width: 1768
  height: 677
---

We're excited to announce support for **Gemini 3 Pro Preview** from Google with an exclusive **20% launch discount**!

## 🎯 New Model Available

### **Gemini 3 Pro Preview** - Next-Generation AI Model

```bash
gemini-3-pro-preview
```

**Launch offer**: Gemini 3 Pro Preview is available with a **20% discount**.  
[View the model page](/models/gemini-3-pro-preview) to explore capabilities, providers, and details.

**Providers**: Available on both **Google AI Studio** and **Google Vertex AI**

## ✨ Features

Gemini 3 Pro Preview comes with comprehensive capabilities:

✅ **Streaming** - Real-time response streaming

✅ **Vision** - Advanced image understanding

✅ **Tools** - Function calling support

✅ **JSON Output** - Structured output mode

✅ **Prompt Caching** - Save up to 90% on repeated prompts

## 🚀 Getting Started

### Using Google AI Studio

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google-ai-studio/gemini-3-pro-preview",
    "messages": [{"role": "user", "content": "Explain machine learning"}]
  }'
```

### Using Google Vertex AI

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google-vertex/gemini-3-pro-preview",
    "messages": [{"role": "user", "content": "Explain machine learning"}]
  }'
```

## 🎁 Why Gemini 3 Pro Preview?

- **Massive Context**: 1M token context window for complex tasks
- **Large Output**: Up to 65k tokens output
- **Cost Efficient**: 20% discount on all token types
- **Smart Caching**: Significant savings with prompt caching
- **Multimodal**: Text and vision capabilities included
- **Dual Providers**: Choose between AI Studio or Vertex AI

---

**[Try in Playground](https://chat.llmgateway.io/?model=google-ai-studio/gemini-3-pro-preview)** 🚀

**[Get started now](/signup)** 🚀
