---
id: openrouter
slug: openrouter
title: Migrate from OpenRouter
description: Switch to LLM Gateway for built-in analytics, self-hosting options, and free bring-your-own-keys at any volume. Two-line code change.
date: 2026-01-20
updatedAt: 2026-09-20
fromProvider: OpenRouter
---

LLM Gateway works just like OpenRouter — same OpenAI-compatible API, same `provider/model` naming — with built-in analytics and the option to self-host. Migration takes two lines of code.

If [Stripe's acquisition of OpenRouter](/blog/stripe-openrouter-acquisition) (announced August 19, 2026) is what brought you here: OpenRouter says nothing changes for customers, so there is no fire to put out. This guide is for teams that want an open-source gateway they can run themselves, or that want to stop paying 5% on bring-your-own-key traffic above $25,000 a month.

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

The OpenRouter-only `HTTP-Referer` and `X-Title` headers can go; nothing on LLM Gateway reads them.

```typescript
// Before (OpenRouter)
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "HTTP-Referer": "https://example.com",
    "X-Title": "My App",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "openai/gpt-6-astra",
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
    model: "openai/gpt-6-astra",
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
  model: "anthropic/claude-sonnet-5",
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
  model: openrouter("openai/gpt-6-astra"),
  prompt: "Hello!",
});

// After (LLM Gateway AI SDK Provider)
import { createLLMGateway } from "@llmgateway/ai-sdk-provider";

const llmgateway = createLLMGateway({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const { text } = await generateText({
  model: llmgateway("openai/gpt-6-astra"),
  prompt: "Hello!",
});
```

## Model Name Mapping

Most OpenRouter IDs work unchanged. A bare ID (no prefix) turns on smart routing across every provider that serves the model; a `provider/model` ID pins one provider. Anthropic versions use dashes instead of OpenRouter's dots.

| OpenRouter Model              | LLM Gateway Model                                                 |
| ----------------------------- | ----------------------------------------------------------------- |
| openai/gpt-6-astra            | gpt-6-astra or openai/gpt-6-astra                                 |
| anthropic/claude-sonnet-5     | claude-sonnet-5 or anthropic/claude-sonnet-5                      |
| anthropic/claude-opus-4.8     | claude-opus-4-8 or anthropic/claude-opus-4-8                      |
| google/gemini-3.1-pro-preview | gemini-3.1-pro-preview or google-ai-studio/gemini-3.1-pro-preview |

Check the [models page](/models) for the full list of available models.

## Provider Routing

OpenRouter selects the upstream through a `provider` object in the request body. LLM Gateway puts that choice in the model ID and a header:

| OpenRouter                            | LLM Gateway                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| No `provider` object                  | Bare model ID — routes on live uptime, throughput, price, and latency          |
| `provider.order: ["Anthropic"]`       | `anthropic/claude-sonnet-5` — pinned, with failover if the provider degrades   |
| `provider.order` with several entries | A dynamic route whose `providers` list is the same ordered fallback preference |
| `provider.allow_fallbacks: false`     | Add the `x-no-fallback: true` header to fail instead of retrying elsewhere     |
| Your own provider keys (BYOK)         | Add keys under Settings > Provider Keys — 0% gateway fee at any monthly volume |

See the [routing](https://docs.llmgateway.io/features/routing) and [dynamic routes](https://docs.llmgateway.io/features/dynamic-routes) documentation for the details.

## Streaming Support

LLM Gateway supports streaming responses identically to OpenRouter:

```typescript
const stream = await client.chat.completions.create({
  model: "anthropic/claude-sonnet-5",
  messages: [{ role: "user", content: "Write a story" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
```

## Full Comparison

Want to see a detailed breakdown of all features? Check out our [LLM Gateway vs OpenRouter comparison page](/compare/open-router), or the [best OpenRouter alternatives in 2026](/blog/openrouter-alternatives) if you are still weighing options.

## Need Help?

- Browse available models at [llmgateway.io/models](/models)
- Read the [API documentation](https://docs.llmgateway.io)
- Contact support at contact@llmgateway.io
