---
id: "22"
slug: "canopywave-partnership-deepseek-90-off"
date: "2025-10-18"
title: "CanopyWave Partnership: 90% Off DeepSeek v3.1"
summary: "Exclusive partnership with CanopyWave brings massive 90% discount on DeepSeek v3.1, making advanced reasoning capabilities more accessible than ever."
image:
  src: "/changelog/canopywave-partnership.png"
  alt: "CanopyWave partnership offering 90% off DeepSeek v3.1"
  width: 1768
  height: 677
---

We're thrilled to announce our new partnership with **CanopyWave**, bringing you an incredible **90% discount** on DeepSeek v3.1 – one of the most powerful reasoning models available.

## 🎉 Massive Savings on Advanced AI

You can now access DeepSeek v3.1 at unprecedented pricing:

**Input Pricing**

- ~~$0.27~~ → **$0.03** per million tokens
- **90% off** regular pricing

**Output Pricing**

- ~~$1.00~~ → **$0.10** per million tokens
- **90% off** regular pricing

## 🧠 DeepSeek v3.1 Through CanopyWave

**Model ID**: `canopywave/deepseek-v3.1`

**Context Window**: 128,000 tokens

## 🚀 Getting Started

**Immediate Access**: The CanopyWave provider is available now through LLM Gateway with the promotional pricing applied automatically.

**Simple Integration**: Use model identifier `canopywave/deepseek-v3.1` in your API calls to access DeepSeek v3.1 at the discounted rate.

**No Additional Setup**: Your existing LLM Gateway API key works seamlessly with the CanopyWave provider.

```javascript
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const { text } = await generateText({
  model: llmgateway("canopywave/deepseek-v3.1"),
  prompt: "Solve this complex problem with advanced reasoning...",
});
```

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "canopywave/deepseek-v3.1",
    "messages": [{"role": "user", "content": "Hello DeepSeek!"}],
  }'
```

---

This partnership with CanopyWave demonstrates our commitment to making cutting-edge AI accessible to everyone. Start using `canopywave/deepseek-v3.1` today and experience premium reasoning capabilities at game-changing prices.

**[Try it now in the Playground](https://chat.llmgateway.io/?model=canopywave/deepseek-v3.1)** 🚀
