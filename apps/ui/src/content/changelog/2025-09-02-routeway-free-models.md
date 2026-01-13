---
id: "17"
slug: "routeway-free-models"
date: "2025-09-02"
title: "Enhanced Auto-Routing & 5 New Free Models via RouteWay"
summary: "Expanding auto-routing options & access DeepSeek R1T2 Chimera, GLM-4.5 Air, Kimi K2, GPT-OSS 20B, and GPT-4.1 completely free through our RouteWay integration."
image:
  src: "/changelog/routeway-free-models.png"
  alt: "Enhanced Auto-Routing & 5 New Free Models via RouteWay"
  width: 1768
  height: 677
---

We're excited to expand our **auto-routing capabilities** with **5 new free models** through our [RouteWay provider](/providers/routeway) integration! These models enhance our intelligent routing system by providing more cost-effective alternatives.

## 🤖 Auto-Routing with Free Models

**Expanded Free Options**: Our intelligent routing system now has more free alternatives to choose from.

**Example Usage**: Use auto-routing with the `free_models_only` flag to prioritize these cost-effective models:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "free_models_only": true,
    "messages": [
      {
        "role": "user",
        "content": "Explain quantum computing in simple terms"
      }
    ]
  }'
```

The system will automatically select the best available free model from the expanded pool, including these new RouteWay options.

## 🆓 New Free Models

All models are available with generous usage limits and zero per-token costs:

### DeepSeek R1T2 Chimera (Free)

```bash
deepseek-r1t2-chimera-free
```

- **Cost**: $0.00 input/output tokens
- **Context Window**: 128,000 tokens
- **Capabilities**: Streaming, JSON output

### GLM-4.5 Air (Free)

```bash
glm-4.5-air-free
```

- **Cost**: $0.00 input/output tokens
- **Context Window**: 128,000 tokens
- **Capabilities**: Streaming, JSON output

### Kimi K2 (Free)

```bash
kimi-k2-free
```

- **Cost**: $0.00 input/output tokens
- **Context Window**: 128,000 tokens
- **Capabilities**: Streaming, JSON output

### GPT-OSS 20B (Free)

```bash
gpt-oss-20b-free
```

- **Cost**: $0.00 input/output tokens
- **Context Window**: 128,000 tokens
- **Capabilities**: Streaming, JSON output

### GPT-4.1 (Free)

```bash
gpt-4.1-free
```

- **Cost**: $0.00 input/output tokens
- **Context Window**: 128,000 tokens
- **Capabilities**: Streaming, JSON output

## 🚀 Getting Started

**Auto-Routing**: These models are automatically available in our routing system - no configuration needed.

**Direct Access**: Use the model identifiers above (with `-free` suffix) to access specific models directly.

**Browse Models**: Visit our [Models Directory](/models) to explore and compare all available options.

---

This expansion significantly enhances our auto-routing system's ability to provide cost-effective AI solutions while maintaining high quality and availability.
