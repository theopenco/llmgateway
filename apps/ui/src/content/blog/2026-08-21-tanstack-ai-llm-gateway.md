---
id: "blog-tanstack-ai-llm-gateway"
slug: "tanstack-ai-llm-gateway"
date: "2026-08-21"
title: "TanStack AI + LLM Gateway: One Adapter, 200+ Models"
summary: "TanStack AI now ships a first-party LLM Gateway adapter. Install @tanstack/ai-llmgateway, add one API key, and your useChat app can stream chat, call tools, and surface reasoning from 200+ models across 40+ providers — switching models is a one-line change."
categories: ["Guides", "Integrations"]
faqs:
  - question: "What is TanStack AI?"
    answer: "TanStack AI is a headless, typed AI framework from the team behind TanStack Query and TanStack Router. It gives you a chat() primitive on the server, useChat hooks for React, Vue, Svelte, Angular, and Preact on the client, and streams responses over the AG-UI event protocol — with provider adapters you swap instead of rewriting your app."
  - question: "How do I use TanStack AI with multiple LLM providers?"
    answer: "Install the first-party @tanstack/ai-llmgateway adapter and set LLM_GATEWAY_API_KEY. The adapter routes through LLM Gateway's OpenAI-compatible endpoint, which reaches 200+ models from 40+ providers with one key. Pass a canonical model ID to let the gateway pick the best provider, or pin one with a provider/model ID."
  - question: "Does the LLM Gateway adapter for TanStack AI support tool calling and reasoning?"
    answer: "Yes. Tools defined with toolDefinition work unchanged, and reasoning models stream their thinking as reasoning_content deltas that the adapter surfaces as AG-UI REASONING_* events — they render as thinking parts in useChat. reasoning_effort accepts an extended scale from none to max."
  - question: "Can I use TanStack AI with a self-hosted LLM Gateway?"
    answer: "Yes. LLM Gateway is open source (AGPLv3). Use createLLMGatewayText and point the baseURL option at your own deployment — the adapter surface stays identical to the hosted gateway at api.llmgateway.io."
image:
  src: "/blog/tanstack-ai-llm-gateway.png"
  alt: "Glossy circuit board with a TanStack-style atom mounted on a central gateway chip, routing neon traces out to many provider model chips"
  width: 1536
  height: 1024
---

Every provider adapter in your chat app hardwires a vendor. Build on TanStack AI with the OpenAI adapter and trying Claude means a new package, a new API key, new billing, and a code change. Multiply that by every model your team wants to evaluate, and "let's compare models" becomes a sprint instead of an afternoon.

That friction is now gone: **TanStack AI** ships a first-party **LLM Gateway** adapter, [merged into the TanStack AI repository](https://github.com/TanStack/ai/pull/1016) alongside the OpenAI and Anthropic adapters. Install `@tanstack/ai-llmgateway`, set one API key, and your app reaches [200+ models from 40+ providers](https://llmgateway.io/models) — switching between them is a one-line string change.

## What is TanStack AI?

TanStack AI is the headless AI framework from the team behind TanStack Query, Router, and Table. The server side is a typed `chat()` primitive with pluggable provider adapters; the client side is a `useChat` hook for React, Vue, Svelte, Angular, and Preact; and the two talk over the AG-UI event protocol, so streaming text, tool calls, and reasoning all arrive as structured events instead of a raw text stream.

The adapter is the seam where the provider plugs in. That is exactly where a gateway belongs: one adapter that speaks to every provider, instead of one adapter per provider.

## Install the TanStack AI LLM Gateway adapter

```bash
pnpm add @tanstack/ai @tanstack/ai-react @tanstack/ai-llmgateway
```

Create an API key in the [LLM Gateway dashboard](https://llmgateway.io/dashboard) and export it:

```bash
export LLM_GATEWAY_API_KEY=llmgtwy_your_key_here
```

## One route, one hook, streaming chat

The server route creates a stream with `chat()` and returns it as server-sent events. `llmGatewayText` reads your key from the environment:

```typescript
// app/api/chat/route.ts
import { chat, toServerSentEventsResponse } from "@tanstack/ai";
import { llmGatewayText } from "@tanstack/ai-llmgateway";

export async function POST(request: Request) {
  const { messages } = await request.json();

  const stream = chat({
    adapter: llmGatewayText("gpt-5.6-terra"),
    messages,
  });

  return toServerSentEventsResponse(stream);
}
```

The client connects `useChat` to that route — no API key in the browser, no provider-specific wiring:

```tsx
// components/chat.tsx
"use client";

import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useState } from "react";

export function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading } = useChat({
    connection: fetchServerSentEvents("/api/chat"),
  });

  return (
    <div>
      {messages.map((message) => (
        <div key={message.id}>
          <strong>{message.role === "assistant" ? "Assistant" : "You"}</strong>
          {message.parts.map((part, index) =>
            part.type === "text" ? <p key={index}>{part.content}</p> : null,
          )}
        </div>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || isLoading) {
            return;
          }
          sendMessage(input);
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Say something..."
        />
      </form>
    </div>
  );
}
```

The example uses a Next.js route handler; a TanStack Start server route works the same way — see the [quick start](https://tanstack.com/ai/latest/docs/getting-started/quick-start) for that variant.

## Switch models without touching your UI

The model is a string, and LLM Gateway accepts it in two formats:

- **Canonical IDs** (`gpt-5.6-terra`, `claude-sonnet-5`) — the gateway routes to the best available provider based on uptime, throughput, price, and latency
- **Provider-prefixed IDs** (`moonshot/kimi-k3`) — pin a specific provider, with automatic failover if its uptime drops below 90%

```typescript
adapter: llmGatewayText("claude-sonnet-5"),  // was "gpt-5.6-terra" — that's the whole migration
```

A curated set of flagship models additionally carries typed metadata with editor autocomplete; every other ID on the [models page](https://llmgateway.io/models) still works. Your `useChat` component doesn't change either way, because the AG-UI events it consumes are provider-agnostic.

<BlogCta variant="gateway" location="mid_article" />

## Tool calling works unchanged

Tools are defined once with `toolDefinition` and a Standard Schema (Zod works out of the box). TanStack AI runs the tool loop on the server, and the gateway forwards the calls to whichever provider is serving the model:

```typescript
import { chat, toServerSentEventsResponse, toolDefinition } from "@tanstack/ai";
import { llmGatewayText } from "@tanstack/ai-llmgateway";
import { z } from "zod";

const getWeather = toolDefinition({
  name: "get_weather",
  description: "Get the current weather for a location",
  inputSchema: z.object({
    location: z.string(),
  }),
}).server(async ({ location }) => {
  return { temperature: 72, condition: "sunny" };
});

const stream = chat({
  adapter: llmGatewayText("gpt-5.6-terra"),
  messages,
  tools: [getWeather],
});
```

## Reasoning models stream their thinking

Reasoning models stream `reasoning_content` deltas through the gateway, and the adapter surfaces them as AG-UI `REASONING_*` events — in `useChat` they arrive as `thinking` parts you can render or hide. Control the depth with `reasoning_effort`:

```typescript
const stream = chat({
  adapter: llmGatewayText("kimi-k3"),
  messages,
  modelOptions: {
    reasoning_effort: "high",
  },
});
```

`reasoning_effort` accepts the extended scale `none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max` on top of OpenAI's standard tiers. Parameters a routed provider doesn't support are stripped server-side, so the same `modelOptions` stay portable across every model you try.

## What the gateway adds underneath

The adapter is thin on purpose — the routing intelligence lives in the gateway:

- **Automatic failover** — if a provider goes down mid-launch-day, requests route to the next healthy one
- **Per-request cost tracking** — every TanStack AI request lands in your [dashboard](https://llmgateway.io/dashboard) with tokens, cost, and latency
- **Response caching** — repeated requests are served from cache and cost nothing
- **Budgets and limits** — hard caps per organization, project, and API key, enforced at the gateway

None of that requires code in your TanStack AI app. It comes with the endpoint.

## Self-host it if you need to

LLM Gateway is open source (AGPLv3). If requests must stay inside your own boundary, point the adapter at your deployment with `createLLMGatewayText`:

```typescript
import { createLLMGatewayText } from "@tanstack/ai-llmgateway";

const adapter = createLLMGatewayText(
  "gpt-5.6-terra",
  process.env.LLM_GATEWAY_API_KEY!,
  {
    baseURL: "https://gateway.internal.example.com/v1",
  },
);
```

The adapter surface is identical against the hosted gateway at `https://api.llmgateway.io/v1` and your own instance, so you can start hosted and move later without touching application code.

## Getting started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — create a key and point `@tanstack/ai-llmgateway` at it
- **[Read the TanStack AI docs page](https://docs.llmgateway.io/developers/tanstack-ai)** — full setup, tool calling, reasoning, and self-hosting reference
- **[Prefer the Vercel AI SDK?](/blog/vercel-ai-gateway-alternative)** — the same one-key, every-model setup works there through `@llmgateway/ai-sdk-provider`

<BlogCta variant="gateway" location="bottom" />
