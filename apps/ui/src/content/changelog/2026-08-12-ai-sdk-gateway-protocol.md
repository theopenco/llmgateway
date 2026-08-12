---
id: "77"
slug: "ai-sdk-gateway-protocol"
date: "2026-08-12"
title: "Drop-In For The Vercel AI Gateway"
summary: "LLM Gateway now speaks the AI SDK's own gateway protocol, so an app built on the Vercel AI Gateway runs here with one line changed. Bare model strings, provider-native web search with citations, and the model picker all keep working."
image:
  src: "/changelog/ai-sdk-gateway-protocol.png"
  alt: "A circuit board with a glowing portal on the central chip and two connectors clicking together in front of it, representing a drop-in gateway swap for the AI SDK"
  width: 1536
  height: 1024
---

When you pass a bare model string to the AI SDK — `streamText({ model: "anthropic/claude-sonnet-5" })` — the SDK does not call an OpenAI-compatible endpoint. It resolves the string through its default provider, `@ai-sdk/gateway`, which speaks a wire format of its own. That single detail is what forced every port off the Vercel AI Gateway to become a rewrite: swap the model resolution, lose provider-native web search, hand-maintain the model list.

**LLM Gateway now implements that protocol.** Point the provider at us and the rest of the app is untouched.

```ts
import { createGateway } from "@ai-sdk/gateway";

globalThis.AI_SDK_DEFAULT_PROVIDER = createGateway({
  baseURL: "https://api.llmgateway.io/v4/ai",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});
```

`@ai-sdk/gateway` already ships as a dependency of `ai`, so there is nothing to install. Every bare model string in the app now routes through LLM Gateway — with response caching, smart routing, cross-provider fallback, and per-request cost analytics behind it.

## Pick The Base URL For Your AI SDK

The protocol carries its specification version in a request header, and every prefix serves the same surface. Use the one matching the `@ai-sdk/gateway` your app has:

| AI SDK | Base URL                          |
| ------ | --------------------------------- |
| 5      | `https://api.llmgateway.io/v1/ai` |
| 6      | `https://api.llmgateway.io/v3/ai` |
| 7      | `https://api.llmgateway.io/v4/ai` |

Model IDs use the `provider/model` form the AI Gateway already uses, so existing model strings resolve unchanged. LLM Gateway's own routing IDs work too: pass a bare `gpt-4o` to let the gateway pick the provider, or `auto` to let it pick the model.

## Web Search Keeps Its Citations

The provider-native search tools are not ordinary function tools — they are provider-defined tools that no OpenAI-compatible endpoint can carry, which is why an `openai-compatible` port silently loses them. This surface maps them onto the gateway's [native web search](https://docs.llmgateway.io/features/web-search):

```ts
import { openai } from "@ai-sdk/openai";

const result = streamText({
  model: gateway("openai/gpt-4o"),
  prompt: "What happened in the news today?",
  tools: { web_search: openai.tools.webSearch() },
});
```

Recognised tools: `openai.web_search`, `openai.web_search_preview`, `anthropic.web_search_20250305`, `anthropic.web_search_20260209`, and `google.google_search`. Results come back as `source-url` message parts plus a provider-executed tool call, so the AI SDK's sources UI renders without changes.

## Model Lists And Balances

`gateway.getAvailableModels()` returns the live catalog with pricing, so a model picker built on `GatewayModel[]` populates itself instead of being hand-maintained. `gateway.getCredits()` returns your organization's balance and lifetime spend.

Features with no field in the AI SDK's call options — reasoning effort, service tier, routing strategy, prompt cache keys — are set through the `llmgateway` provider options namespace:

```ts
providerOptions: {
	llmgateway: { reasoning_effort: "high", routing: "price" },
}
```

This surface serves language models. Embeddings, images, video, speech, transcription and reranking stay on the OpenAI-compatible endpoints, where [`@llmgateway/ai-sdk-provider`](https://docs.llmgateway.io/developers/ai-sdk) covers them.

---

**[AI SDK Gateway protocol docs →](https://docs.llmgateway.io/developers/ai-sdk-gateway-protocol)** | **[Get an API key →](https://llmgateway.io/dashboard)**
