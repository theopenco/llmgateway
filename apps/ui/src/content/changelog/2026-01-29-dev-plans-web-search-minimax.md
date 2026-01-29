---
id: "37"
slug: "dev-plans-web-search-minimax"
date: "2026-01-29"
title: "Dev Plans, Native Web Search, and MiniMax Provider"
summary: "Ship faster with Dev Plans — AI-powered development planning now in beta. Plus native web search for real-time data, MiniMax provider, structured outputs for Anthropic & Perplexity, and a redesigned models experience."
image:
  src: "/changelog/dev-plans-web-search.png"
  alt: "Dev Plans dashboard and web search capabilities"
  width: 1408
  height: 768
---

## Dev Plans: AI-Powered Development Planning (Beta)

We're launching **Dev Plans** — a new way to plan and execute software projects with AI assistance. Break down complex features into actionable steps, get implementation guidance, and ship faster.

**[Try Dev Plans now](https://code.llmgateway.io)** — we're looking for early feedback to shape the product.

### What you can do

- **Plan features** — describe what you want to build and get a structured implementation plan
- **Break down tasks** — complex projects split into manageable, actionable steps
- **Get code guidance** — AI-assisted implementation recommendations

Dev Plans is available on all paid plans. We'd love your feedback as we iterate on this feature.

---

## Native Web Search

LLM responses can now include **real-time web data**. No more outdated information — your AI assistant can search the web to answer questions about current events, recent releases, or live data.

### How it works

Web search is billed per search call and works seamlessly with supported models. **[Read the docs](https://docs.llmgateway.io/features/web-search)**

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "What are the latest AI announcements this week?"}],
    "web_search": true
  }'
```

---

## MiniMax Provider

We've added **MiniMax** as a new provider, expanding your options for high-quality language models. MiniMax offers competitive pricing and strong performance across various tasks.

**[View MiniMax models](/models?provider=minimax)**

---

## Structured Outputs for Anthropic & Perplexity

Get reliable JSON responses with **structured outputs** — now available for Anthropic Claude models and Perplexity. Define your schema and get guaranteed valid JSON back.

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-20250514",
    "messages": [{"role": "user", "content": "Extract the name and email from: John Smith, john@example.com"}],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "contact",
        "schema": {
          "type": "object",
          "properties": {
            "name": {"type": "string"},
            "email": {"type": "string"}
          }
        }
      }
    }
  }'
```

---

## Redesigned Models Experience

The models page got a major upgrade:

- **Flattened table structure** — easier to scan and compare models at a glance
- **Clickable model IDs** — copy model identifiers with one click
- **Web search pricing** — see which models support web search and at what cost
- **Coding models filter** — quickly find models optimized for code generation

**[Explore the new models page](/models)**

---

## New Models

### GLM-4.7 Family

The latest GLM models are now available across multiple providers:

**[zai/glm-4.7-flash](/models/glm-4.7-flash/zai)** — fast and efficient

```
zai/glm-4.7-flash
```

**[Try in Playground](https://chat.llmgateway.io/?model=zai/glm-4.7-flash)**

**[zai/glm-4.7-flashx](/models/glm-4.7-flashx/zai)** — extended context

```
zai/glm-4.7-flashx
```

**[Try in Playground](https://chat.llmgateway.io/?model=zai/glm-4.7-flashx)**

**[cerebras/glm-4.7](/models/glm-4.7/cerebras)** — ultra-low latency via Cerebras

```
cerebras/glm-4.7
```

**[Try in Playground](https://chat.llmgateway.io/?model=cerebras/glm-4.7)**

**[novita/glm-4.7-flash](/models/glm-4.7-flash/novita)** — cost-effective option

```
novita/glm-4.7-flash
```

**[Try in Playground](https://chat.llmgateway.io/?model=novita/glm-4.7-flash)**

### Image Generation

**[zai/cogview-4](/models/cogview-4/zai)** — advanced image generation from Z.AI

```
zai/cogview-4
```

**[zai/glm-image](/models/glm-image/zai)** — text-to-image with excellent text rendering

```
zai/glm-image
```

**[bytedance/seedream-4.0](/models/seedream-4.0/bytedance)** — high-quality image synthesis

```
bytedance/seedream-4.0
```

**[bytedance/seedream-4.5](/models/seedream-4.5/bytedance)** — high-quality image synthesis

```
bytedance/seedream-4.5
```

### ByteDance ModelArk

Eight new models from ByteDance including GPT-OSS-120B variants. **[View all ByteDance models](/models?provider=bytedance)**

---

## More Improvements

- **JSON Response Healing** — malformed JSON from models is automatically repaired. [Read the docs](https://docs.llmgateway.io/features/response-healing)
- **API Key Usage Filters** — filter your usage statistics by specific API keys. [Read the docs](https://docs.llmgateway.io/features/api-keys)
- **Playground Upgrades** — AI SDK v6, Web Search, improved scrolling
- **Better Error Handling** — improved fallback routing when providers have issues. [Read the docs](https://docs.llmgateway.io/features/routing)

---

**[Try Dev Plans](https://code.llmgateway.io)** — your feedback shapes the product.

**[Explore new models](/models)** — find the right model for your use case.

**[Get started](/signup)** — free tier available.
