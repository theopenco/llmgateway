---
id: "34"
slug: "qwen-image-models-support"
date: "2026-01-02"
title: "Alibaba Cloud Qwen Image Models: Advanced Image Generation and Editing"
summary: "Introducing Alibaba Cloud's Qwen Image model family - powerful models for text-to-image generation and image editing, now available in four variants: Qwen Image, Qwen Image Max, Qwen Image Max 2025-12-30, and Qwen Image Plus."
image:
  src: "/changelog/qwen-image-models-support.png"
  alt: "Alibaba Cloud Qwen Image models now available on LLM Gateway"
  width: 1768
  height: 677
---

We're excited to announce support for **Alibaba's Qwen Image model family**, a suite of text-to-image generation models that excel at rendering text within images. This addition expands our image generation capabilities with multiple model variants to fit your needs.

**[Try them now in the Chat Playground](https://chat.llmgateway.io/?model=alibaba/qwen-image-max)** 🎨

**[Learn more about Alibaba models in our docs](https://docs.llmgateway.io/features/image-generation#alibaba-models)** 📚

## 📊 Model Specifications

We've added four variants to suit different needs:

**Qwen Image**

```bash
alibaba/qwen-image
```

- **Pricing**: $0.035/req
- **Best for**: Testing and experimentation

**Qwen Image Plus**

```bash
alibaba/qwen-image-plus
```

- **Pricing**: $0.030/req
- **Best for**: Enhanced quality at no cost

**Qwen Image Max**

```bash
alibaba/qwen-image-max
```

- **Pricing**: $0.075 per request
- **Best for**: Production use with consistent quality

**Qwen Image Max 2025-12-30**

```bash
alibaba/qwen-image-max-2025-12-30
```

- **Pricing**: $0.075 per request
- **Best for**: Latest version with the most recent improvements

**All models feature**:

- **Provider**: Alibaba
- **Family**: Alibaba
- **Capabilities**: Image generation with excellent text rendering

## 🚀 Getting Started

Access any Qwen Image model through our OpenAI-compatible API:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "alibaba/qwen-image-max",
    "messages": [{"role": "user", "content": "Create a motivational poster with the text Welcome to 2026"}]
  }'
```

## 🎯 Perfect For

**Marketing Materials**: Generate promotional images, posters, and banners with crisp, readable text.

**Social Media Content**: Create eye-catching visuals with text overlays for social media posts.

**Infographics**: Produce informative graphics with clear, well-rendered text elements.

**Educational Content**: Generate illustrative materials with labels and annotations.

---

**[Try Qwen Image Models in the Playground](https://chat.llmgateway.io/?model=alibaba/qwen-image-max)** 🎨

**[Read the full documentation](https://docs.llmgateway.io/features/image-generation#alibaba-models)** 📚

**[Get started now](/signup)** 🚀
