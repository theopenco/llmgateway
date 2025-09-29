---
id: "23"
slug: "claude-sonnet-4-5-support"
date: "2025-09-29"
title: "Claude Sonnet 4.5 Model Support"
summary: "Added support for Anthropic's Claude Sonnet 4.5"
image:
  src: "/changelog/sonnet-4.5.png"
  alt: "Claude Sonnet models available via Anthropic provider on LLM Gateway"
  width: 1768
  height: 677
---

We're excited to announce support for **Claude Sonnet 4.5**, the latest balanced model from Anthropic, now available through LLM Gateway.

## 📊 Model Specifications

**Claude Sonnet 4.5**

- **Model ID**: `claude-sonnet-4-5`
- **Provider**: Anthropic
- **Context Window**: 200,000 tokens
- **Input Price**: $3.00 per million tokens
- **Output Price**: $15.00 per million tokens

Optimized for fast, intelligent responses across a wide range of applications with excellent cost-performance.

## 🚀 Getting Started

Use model identifier `claude-sonnet-4-5` in your API calls to access the model.

### AI SDK

```typescript
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const { text } = await generateText({
  model: llmgateway("claude-sonnet-4-5"),
  prompt: `Analyze this complex document with your 400k context window...`,
});
```

## API

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5",
    "messages": [{"role": "user", "content": "Hello GPT-5!"}]
  }'
```

---

**[Try it now in the new Playground](https://chat.llmgateway.io?model=claude-sonnet-4-5)** 🚀
