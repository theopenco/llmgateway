---
id: "13"
slug: "canopywave-new-models"
date: "2025-11-08"
title: "CanopyWave: 3 New Models with 75% Off"
summary: "CanopyWave brings Qwen3 Coder, MiniMax M2, and GLM-4.6 to LLM Gateway with an exclusive 75% discount on all three models."
image:
  src: "/changelog/canopywave75.png"
  alt: "CanopyWave: 3 New Models with 75% Off"
  width: 2046
  height: 1102
---

We're excited to announce three new models from **CanopyWave** with an exclusive **75% discount** on all models!

## 🎯 New Models Available

### **GLM-4.6** - Advanced Reasoning

- **Model ID**: `glm-4.6`
- **Provider**: `canopywave/zai/glm-4.6`
- **Context Window**: 202,752 tokens
- **Pricing**: $0.45 per 1M input tokens / $1.50 per 1M output tokens (75% off)
- Enhanced reasoning and tool calling capabilities

### **Qwen3 Coder** - Specialized Coding Model

- **Model ID**: `qwen3-coder`
- **Provider**: `canopywave/qwen/qwen3-coder`
- **Context Window**: 262,000 tokens
- **Pricing**: $0.22 per 1M input tokens / $0.95 per 1M output tokens (75% off)
- Advanced coding capabilities with massive context window

### **MiniMax M2** - High-Performance Chat

- **Model ID**: `minimax-m2`
- **Provider**: `canopywave/minimax/minimax-m2`
- **Context Window**: 196,608 tokens
- **Pricing**: $0.25 per 1M input tokens / $1.00 per 1M output tokens (75% off)
- Powerful conversational AI with large context support

## 🚀 Getting Started

All models support streaming, tool calling, and JSON output mode:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder",
    "messages": [{"role": "user", "content": "Write a Python function"}]
  }'
```

✅ **75% Discount** - Exclusive pricing for all three models
✅ **Large Context Windows** - 196k-262k tokens
✅ **Full Feature Support** - Streaming, tools, JSON output
✅ **Instant Access** - Available now

---

**[Get started now](/signup)** 🚀
