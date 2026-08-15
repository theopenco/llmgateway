---
id: "blog-vercel-ai-gateway-alternative"
slug: "vercel-ai-gateway-alternative"
date: "2026-08-12"
title: "A Vercel AI Gateway Alternative Without the Rewrite"
summary: "Switching off the Vercel AI Gateway used to mean rewriting how your AI SDK app resolves models — and losing provider-native web search on the way out. LLM Gateway now implements the AI SDK's own gateway protocol, so the migration is one line and your bare model strings keep working."
categories: ["Announcements", "Engineering"]
faqs:
  - question: "Is there a Vercel AI Gateway alternative that works without changing my code?"
    answer: "Yes — as long as your app uses the AI SDK. LLM Gateway implements the same gateway protocol `@ai-sdk/gateway` speaks, so setting `globalThis.AI_SDK_DEFAULT_PROVIDER` to a `createGateway({ baseURL })` instance is the entire migration. Model strings, tool definitions, streaming, and the message-part rendering in your UI all stay as they are."
  - question: "Why can't I just use an OpenAI-compatible provider instead?"
    answer: "You can, and for a simple text app it works. What you lose is everything that lives above the OpenAI wire format: provider-native web search, the `source-url` citation parts your sources UI renders, and `getAvailableModels()` for the model picker. `@ai-sdk/openai-compatible` has no annotation handling at all, so citations cannot survive that path even if the gateway returns them."
  - question: "Which AI SDK versions are supported?"
    answer: "AI SDK 5, 6, and 7 — language model specification versions 2, 3, and 4. Each `@ai-sdk/gateway` major has a different default base-URL path, so use the matching prefix from the table above. The specification version travels in a request header and the gateway answers in the shape that version expects, including its usage-reporting format."
  - question: "Do I have to move everything at once?"
    answer: "No. `createGateway({ baseURL })` produces an ordinary provider instance, so you can point one route at LLM Gateway and leave the rest where it is. Set `globalThis.AI_SDK_DEFAULT_PROVIDER` only when you are ready for every bare model string to move."
image:
  src: "/blog/vercel-ai-gateway-alternative.png"
  alt: "A circuit board with a glowing doorway on the central chip, representing a drop-in Vercel AI Gateway alternative for the AI SDK"
  width: 1536
  height: 1024
---

You wrote your app against the AI SDK. Somewhere in a route handler there is a line like this:

```ts
const result = streamText({ model: "anthropic/claude-sonnet-5", messages });
```

Now you want to move that traffic somewhere else — for response caching, for cross-provider fallback, for per-request cost analytics, or because the app has to run somewhere other than Vercel. So you look for a Vercel AI Gateway alternative, and discover the migration is not the base-URL change you assumed it would be.

**LLM Gateway** now implements the AI SDK's own gateway protocol. The migration is the base-URL change you assumed it would be.

## Why Swapping Gateways Usually Means a Rewrite

That bare model string is the whole problem. It is not an OpenAI-compatible call. The AI SDK resolves a bare string through its **default provider**, `@ai-sdk/gateway`, which speaks a wire format of its own — the AI SDK's internal `LanguageModelV*` call options going out, `LanguageModelV*` content and stream parts coming back — against Vercel's endpoint.

An OpenAI-compatible gateway cannot answer that. So the standard port looks like this:

```diff
- const result = streamText({ model: modelId, messages })
+ const provider = createOpenAICompatible({ name: "x", baseURL, apiKey })
+ const result = streamText({ model: provider.chatModel(modelId), messages })
```

Which looks harmless, and then you find the rest of the bill:

- **Provider-native web search stops working.** `openai.tools.webSearch()` and `anthropic.tools.webSearch_20260209()` are not function tools. They are provider-defined tools that live in the SDK's spec layer, and no `/chat/completions` field carries them. They have to be replaced with a server-executed tool and a third-party search API key.
- **Your citations disappear with them.** `@ai-sdk/openai-compatible` has no handling for response annotations, so even a gateway that returns `url_citation` data has nowhere to put it. The `source-url` message parts stop arriving and the "Searched N websites" panel in your UI goes permanently empty.
- **Your model picker becomes a hand-maintained array.** `gateway.getAvailableModels()` is gone, so the list of models your users can choose from is now a constant you have to remember to update.

None of that is a large amount of code. All of it is code you did not intend to own.

## The One-Line Version

The AI SDK resolves bare model strings through `globalThis.AI_SDK_DEFAULT_PROVIDER`, falling back to Vercel's gateway. Set it, and every bare string in the app routes through LLM Gateway instead:

```ts
import { createGateway } from "@ai-sdk/gateway";

globalThis.AI_SDK_DEFAULT_PROVIDER = createGateway({
  baseURL: "https://api.llmgateway.io/v4/ai",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});
```

Put it wherever your app runs before its first model call — a Next.js `instrumentation.ts`, a server entrypoint, a platform-injected preamble. `@ai-sdk/gateway` already ships as a dependency of `ai`, so there is nothing new to install and no import to change.

Prefer to be explicit? Build the provider and pass it per call. Same protocol, same result:

```ts
const gateway = createGateway({
  baseURL: "https://api.llmgateway.io/v4/ai",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const result = streamText({
  model: gateway("anthropic/claude-sonnet-5"),
  prompt: "Hello!",
});
```

One note that costs people an afternoon: `@ai-sdk/gateway` reads its API key from `AI_GATEWAY_API_KEY`, but there is **no** environment variable for the base URL. It is a constructor option only. That is why this is a line of code rather than an entry in your `.env`.

Pick the prefix matching the `@ai-sdk/gateway` your app has — the protocol version travels in a request header, and all three prefixes serve the same surface:

| AI SDK | Base URL                          |
| ------ | --------------------------------- |
| 5      | `https://api.llmgateway.io/v1/ai` |
| 6      | `https://api.llmgateway.io/v3/ai` |
| 7      | `https://api.llmgateway.io/v4/ai` |

Model IDs use the same `provider/model` convention, so `anthropic/claude-sonnet-5` and `openai/gpt-4o` resolve unchanged. LLM Gateway's own routing IDs work too: pass a bare `gpt-4o` to let the gateway pick the provider on price, throughput, or latency, or `auto` to let it pick the model.

<BlogCta variant="gateway" location="mid_article" />

## Web Search Keeps Its Citations

This is the part an OpenAI-compatible port cannot recover, so it is worth showing working:

```ts
import { openai } from "@ai-sdk/openai";

const result = streamText({
  model: gateway("openai/gpt-4o"),
  prompt: "What happened in the news today?",
  tools: { web_search: openai.tools.webSearch() },
});
```

The gateway recognises the provider-defined tool — `openai.web_search`, `openai.web_search_preview`, `anthropic.web_search_20250305`, `anthropic.web_search_20260209`, `google.google_search` — and maps it onto its own native web search. Results come back as `source-url` message parts plus a provider-executed tool call, which is exactly what the AI SDK's sources UI already renders. No Tavily key, no replacement tool, no dead panel.

A provider tool with no gateway equivalent is reported as a warning on the result rather than failing the request, so an app using a server-side tool we do not support yet degrades instead of breaking.

## What You Get for the Line

The point of moving is not the move. Everything on this surface goes through the same request path as every other LLM Gateway endpoint:

- **Response caching** on identical requests, keyed on the request body
- **Cross-provider fallback** — when a provider errors or rate-limits, the request retries on the next healthy one instead of surfacing a 500
- **Smart routing** across providers by price, throughput, or latency
- **Per-request cost and usage analytics**, with the cost reported back on `providerMetadata.gateway.cost` — the same field Vercel AI Gateway apps already read

`gateway.getAvailableModels()` returns the live catalog with pricing, so a model picker built on `GatewayModel[]` populates itself. `gateway.getCredits()` returns your organization's balance and lifetime spend.

Gateway features that have no field in the AI SDK's call options — reasoning effort, service tier, routing strategy, prompt cache keys — go through a provider options namespace:

```ts
const result = streamText({
  model: gateway("openai/gpt-5.6-terra"),
  prompt: "Hello!",
  providerOptions: {
    llmgateway: { reasoning_effort: "high", routing: "price" },
  },
});
```

## What This Surface Does Not Cover

Honest limits, so you find them here rather than in production:

- It serves **language models**. Embeddings, images, video, speech, transcription, and reranking stay on the OpenAI-compatible endpoints, where [`@llmgateway/ai-sdk-provider`](https://docs.llmgateway.io/developers/ai-sdk) covers them.
- Three call options have no chat-completions equivalent — `stopSequences`, `seed`, and `topK`. They are reported as `unsupported` warnings on the result rather than silently dropped, so you can see what did not reach the provider.

No plan gating: this works on the free plan with any API key.

---

**[Try LLM Gateway free](https://llmgateway.io/signup)** — one API across every major provider, with automatic failover.

- **[AI SDK Gateway protocol docs →](https://docs.llmgateway.io/developers/ai-sdk-gateway-protocol)** — the full surface, including provider options
- **[Migrate from the Vercel AI Gateway →](https://docs.llmgateway.io/migrations/vercel-ai-gateway)** — both migration paths side by side
- **[Ranked #1 on an independent AI gateway benchmark →](/blog/ai-gateway-benchmark)** — what the extra hop actually costs

<BlogCta variant="gateway" location="bottom" />
