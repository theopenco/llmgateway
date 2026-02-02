---
id: openrouter
slug: openrouter
title: Migrate from OpenRouter
description: Switch to LLM Gateway for built-in analytics, self-hosting options, and simpler API. Two-line code change.
date: 2026-01-20
fromProvider: OpenRouter
---

LLM Gateway works just like OpenRouter—same API format, same model names—but with built-in analytics and the option to self-host. Migration takes two lines of code.

## Quick Migration

Change your base URL and API key:

```diff
- const baseURL = "https://openrouter.ai/api/v1";
- const apiKey = process.env.OPENROUTER_API_KEY;
+ const baseURL = "https://api.llmgateway.io/v1";
+ const apiKey = process.env.LLM_GATEWAY_API_KEY;
```

## Migration Steps

### 1. Get Your LLM Gateway API Key

Sign up at [llmgateway.io/signup](/signup) and create an API key from your dashboard.

### 2. Update Environment Variables

```bash
# Remove OpenRouter credentials
# OPENROUTER_API_KEY=sk-or-...

# Add LLM Gateway credentials
LLM_GATEWAY_API_KEY=llmgtwy_your_key_here
```

### 3. Update Your Code

#### Using fetch/axios

```typescript
// Before (OpenRouter)
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "openai/gpt-5.2",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});

// After (LLM Gateway)
const response = await fetch("https://api.llmgateway.io/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.LLM_GATEWAY_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-5.2",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
```

#### Using OpenAI SDK

```typescript
import OpenAI from "openai";

// Before (OpenRouter)
const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// After (LLM Gateway)
const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

// Usage remains the same
const completion = await client.chat.completions.create({
  model: "anthropic/claude-3-5-sonnet-20241022",
  messages: [{ role: "user", content: "Hello!" }],
});
```

#### Using Vercel AI SDK

Both OpenRouter and LLM Gateway have native AI SDK providers, making migration straightforward:

```typescript
import { generateText } from "ai";

// Before (OpenRouter AI SDK Provider)
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const { text } = await generateText({
  model: openrouter("gpt-5.2"),
  prompt: "Hello!",
});

// After (LLM Gateway AI SDK Provider)
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLMGATEWAY_API_KEY,
});

const { text } = await generateText({
  model: llmgateway("gpt-5.2"),
  prompt: "Hello!",
});
```

## Model Name Mapping

Most model names are compatible, but here are some common mappings:

| OpenRouter Model                 | LLM Gateway Model                                                 |
| -------------------------------- | ----------------------------------------------------------------- |
| openai/gpt-5.2                   | gpt-5.2 or openai/gpt-5.2                                         |
| gemini/gemini-3-flash-preview    | gemini-3-flash-preview or google-ai-studio/gemini-3-flash-preview |
| bedrock/claude-opus-4-5-20251101 | claude-opus-4-5-20251101 or aws-bedrock/claude-opus-4-5-20251101  |

Check the [models page](/models) for the full list of available models.

## Streaming Support

LLM Gateway supports streaming responses identically to OpenRouter:

```typescript
const stream = await client.chat.completions.create({
  model: "anthropic/claude-3-5-sonnet-20241022",
  messages: [{ role: "user", content: "Write a story" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

## Full Comparison

Want to see a detailed breakdown of all features? Check out our [LLM Gateway vs OpenRouter comparison page](/compare/open-router).

## Need Help?

- Browse available models at [llmgateway.io/models](/models)
- Read the [API documentation](https://docs.llmgateway.io)
- Contact support at contact@llmgateway.io
