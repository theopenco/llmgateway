---
id: blog-getting-started-in-5-minutes
slug: getting-started-in-5-minutes
date: 2026-02-08
title: "Getting Started with LLM Gateway in 5 Minutes"
summary: "A step-by-step guide to making your first LLM API request through LLM Gateway — from signup to seeing results in your dashboard."
categories: ["Guides"]
image:
  src: "/blog/getting-started-in-5-minutes.png"
  alt: "Getting Started with LLM Gateway in 5 Minutes"
  width: 1408
  height: 768
---

This guide walks you through making your first LLM request through LLM Gateway. By the end, you'll have a working API key and a completed request visible in your dashboard.

## Step 1: Get an API Key

1. [Sign in to the dashboard](/signup).
2. Create a new **Project**.
3. Copy the API key.
4. Export it in your shell or add it to a `.env` file:

```bash
export LLM_GATEWAY_API_KEY="llmgtwy_XXXXXXXXXXXXXXXX"
```

## Step 2: Make Your First Request

LLM Gateway uses an OpenAI-compatible API. Point your requests to `https://api.llmgateway.io/v1` and you're done.

### Using curl

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "What is an LLM gateway?"}
    ]
  }'
```

### Using Node.js (OpenAI SDK)

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "What is an LLM gateway?" }],
});

console.log(response.choices[0].message.content);
```

### Using Python

```python
import requests
import os

response = requests.post(
    "https://api.llmgateway.io/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.getenv('LLM_GATEWAY_API_KEY')}",
    },
    json={
        "model": "gpt-4o",
        "messages": [
            {"role": "user", "content": "What is an LLM gateway?"}
        ],
    },
)

response.raise_for_status()
print(response.json()["choices"][0]["message"]["content"])
```

### Using the AI SDK

If you're using the Vercel AI SDK, you can use our native provider:

```typescript
import { llmgateway } from "@llmgateway/ai-sdk-provider";
import { generateText } from "ai";

const { text } = await generateText({
  model: llmgateway("openai/gpt-4o"),
  prompt: "What is an LLM gateway?",
});
```

Or use the OpenAI-compatible adapter:

```typescript
import { createOpenAI } from "@ai-sdk/openai";

const llmgateway = createOpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY!,
});
```

## Step 3: Enable Streaming

Pass `stream: true` to any request and the gateway will proxy the event stream unchanged:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Write a short poem about APIs"}
    ]
  }'
```

## Step 4: Monitor in the Dashboard

Every call appears in the dashboard with latency, cost, and provider breakdown. Go back to your project to see your request logged with the model used, token counts, cost, and response time.

## Step 5: Try a Different Provider

The best part of using a gateway: switching providers is a one-line change. Try the same request with a different model:

```bash
# Anthropic
"model": "anthropic/claude-haiku-4-5"

# Google
"model": "google-ai-studio/gemini-2.5-flash"
```

Same API, same code. Just a different model string.

## What's Next

- **[Try models in the Playground](https://chat.llmgateway.io)** — test any model with a chat interface before integrating
- **[Browse all models](/models)** — compare pricing, context windows, and capabilities
- **[Read the full docs](https://docs.llmgateway.io)** — streaming, tool calling, structured output, and more
- **[Join our Discord](https://llmgateway.io/discord)** — get help and share what you're building

**[Get started now](/signup)**
