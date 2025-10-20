---
id: "18"
slug: "qwen3-max-support"
date: "2025-09-05"
title: "Qwen3 Max Model Now Available"
summary: "Access Alibaba's powerful Qwen3 Max model with 256K context window, advanced reasoning capabilities, vision support, and function calling - all at competitive pricing."
image:
  src: "/changelog/qwen3-max-support.png"
  alt: "Qwen3 Max model now available on LLM Gateway"
  width: 1768
  height: 677
---

We're excited to announce support for **Qwen3 Max**, Alibaba's most advanced language model, now available through LLM Gateway. Experience cutting-edge AI capabilities with extensive context and multimodal support.

## 🚀 Qwen3 Max Overview

**Industry-Leading Performance**: Qwen3 Max represents the pinnacle of Alibaba's AI research, delivering exceptional performance across reasoning, coding, mathematics, and creative tasks.

**Massive Context Window**: With 256K tokens of context, handle the most demanding applications including long-document analysis, extensive conversations, and complex multi-turn reasoning.

**Multimodal Capabilities**: Beyond text, Qwen3 Max supports vision tasks, making it perfect for applications requiring image understanding and analysis.

## 📊 Model Specifications

**Qwen3 Max**

- **Model ID**: `qwen/qwen3-max`
- **Provider**: Alibaba Cloud
- **Context Window**: 256,000 tokens
- **Input Price**: $3.00 per million tokens
- **Output Price**: $15.00 per million tokens
- **Capabilities**: Streaming, Vision, Tools, Reasoning

## ✨ Key Capabilities

**🧠 Advanced Reasoning**: Excel at complex logical reasoning, multi-step problem-solving, and analytical thinking with sophisticated chain-of-thought capabilities.

**👁️ Vision Support**: Process and analyze images alongside text for comprehensive multimodal understanding and interaction.

**🔧 Function Calling**: Native support for tool use and function calling, enabling complex workflows and integrations.

**⚡ Streaming**: Real-time response generation for interactive applications and chat interfaces.

## 🎯 Perfect For

**Complex Analysis**: Handle lengthy research papers, technical documentation, and multi-document analysis with the 256K context window.

**Multimodal Applications**: Build applications that combine text and image processing for richer user experiences.

**Advanced Reasoning Tasks**: Tackle sophisticated problems requiring deep logical thinking and step-by-step analysis.

**Tool-Enhanced Workflows**: Integrate with external APIs and functions for powerful, automated workflows.

## 🚀 Getting Started

**Immediate Availability**: Qwen3 Max is available now through our unified API with no additional setup required.

**API Integration**: Use model identifier `qwen/qwen3-max` in your API calls to access the model.

**Full Feature Support**: Take advantage of streaming, vision, and function calling capabilities through our standard API interface.

```javascript
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const { text } = await generateText({
  model: llmgateway("qwen3-max"),
  prompt: "Analyze this complex document with your 256K context...",
});
```

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-max",
    "messages": [{"role": "user", "content": "Hello Qwen3 Max!"}],
    "stream": true
  }'
```

✅ **Streaming Support** - Real-time response generation  
✅ **Vision Capabilities** - Image understanding and analysis  
✅ **Function Calling** - Native tool integration  
✅ **256K Context** - Handle massive documents  
✅ **Advanced Reasoning** - Sophisticated problem-solving

---

**[Try it now in the Playground](https://chat.llmgateway.io/?model=alibaba/qwen3-max)** 🚀
