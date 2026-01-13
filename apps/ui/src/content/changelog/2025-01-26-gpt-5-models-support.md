---
id: "12"
slug: "gpt-5-models-support"
date: "2025-08-07"
title: "GPT-5 Model Family Now Available"
summary: "Get instant access to OpenAI's powerful new GPT-5 model family including gpt-5, gpt-5-mini, gpt-5-nano, and gpt-5-chat-latest with 400k context windows."
image:
  src: "/changelog/gpt-5-models.png"
  alt: "GPT-5 models now available on LLM Gateway"
  width: 1768
  height: 677
---

OpenAI's **GPT-5 model family** is now available on LLM Gateway! Access all four models instantly with 400k context windows - **no organization verification needed**.

## 🤖 New GPT-5 Models Available

### **GPT-5** - The Flagship Model

```bash
openai/gpt-5
```

- **Context Window**: 400,000 tokens
- **Pricing**: $1.25 per 1M input tokens / $10.00 per 1M output tokens
- Perfect for complex reasoning, creative tasks, and advanced problem-solving

### **GPT-5 Mini** - Optimized Performance

```bash
openai/gpt-5-mini
```

- **Context Window**: 400,000 tokens
- **Pricing**: $0.25 per 1M input tokens / $2.00 per 1M output tokens
- Ideal for most production applications with excellent cost-efficiency

### **GPT-5 Nano** - Ultra-Fast & Affordable

```bash
openai/gpt-5-nano
```

- **Context Window**: 400,000 tokens
- **Pricing**: $0.05 per 1M input tokens / $0.40 per 1M output tokens
- Lightning-fast responses for high-volume applications

### **GPT-5 Chat Latest** - Conversational Excellence

```bash
openai/gpt-5-chat-latest
```

- **Context Window**: 400,000 tokens
- **Pricing**: $1.25 per 1M input tokens / $10.00 per 1M output tokens
- Optimized for chat interfaces and conversational AI

## 🚀 Getting Started

All GPT-5 models are available immediately through our unified API. Simply use the model IDs above in your requests:

```javascript
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const { text } = await generateText({
  model: llmgateway("openai/gpt-5"),
  prompt: `Analyze this complex document with your 400k context window...`,
});
```

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-5-mini",
    "messages": [{"role": "user", "content": "Hello GPT-5!"}]
  }'
```

✅ **No Organization Verification** - Start using GPT-5 immediately  
✅ **Instant Access** - No waitlists or approval process  
✅ **Transparent Pricing** - Per-million-token pricing  
✅ **Unified API** - Same interface as all other models  
✅ **Advanced Monitoring** - Track usage and costs

---

**[Get started now](/signup)** 🚀
