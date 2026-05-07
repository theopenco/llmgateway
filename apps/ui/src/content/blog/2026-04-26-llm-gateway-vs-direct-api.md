---
id: blog-llm-gateway-vs-direct-api
slug: llm-gateway-vs-direct-api
date: 2026-04-26
title: "LLM Gateway vs Direct API: When the Provider SDK Stops Scaling"
summary: "Calling OpenAI or Anthropic directly is the right first call. Here's the honest case for when a gateway starts paying for itself — and when you don't need one yet."
categories: ["Guides"]
image:
  src: "/blog/llm-gateway-vs-direct-api.png"
  alt: "LLM Gateway vs Direct API: When the Provider SDK Stops Scaling"
  width: 1672
  height: 941
---

The best first integration with an LLM is the simplest one. Install the provider SDK, paste your API key into an environment variable, call `chat.completions.create()`, ship the feature. If you're on day one of adding AI to an app, stop reading this and go do that.

This post is for what happens on day thirty, or day ninety, when the simple path starts accumulating silent costs: a second provider, a third API key rotation, a surprise bill, a 503 during a launch, a "why did that request cost $4" Slack thread. That's when a gateway starts paying for itself — and some teams realize too late.

## When the Direct API Is the Right Call

A gateway is infrastructure. Infrastructure you don't need is a tax. The direct API is better when:

- **You only call one provider**, and you have no plans to add another
- **Observability is handled elsewhere** (Datadog, OpenTelemetry) and you're comfortable adding LLM spans yourself
- **Your traffic is low enough** that a single provider outage is a minor inconvenience, not a business problem
- **You're prototyping** and the feature may not ship

For those cases, the OpenAI SDK plus a cost dashboard in the provider console is fine. Don't add a layer you don't need.

## Signals the Direct API Is Costing You More Than It Looks

Here are the signs — any two of these and a gateway is probably already cheaper than not having one.

### 1. You integrate with a second provider

The first provider is free. The second one is where the abstraction tax starts compounding. Different SDK, different auth, different request/response shapes, different streaming format, different error codes. You'll write an adapter. Then you'll maintain it every time either provider ships a breaking change.

A gateway normalizes that to one OpenAI-compatible call, for every provider:

```typescript
const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

// Same code for OpenAI, Anthropic, Google, DeepSeek, Groq, Cerebras...
const openai = await client.chat.completions.create({
  model: "gpt-5",
  messages,
});
const claude = await client.chat.completions.create({
  model: "claude-opus-4-6",
  messages,
});
const gemini = await client.chat.completions.create({
  model: "gemini-2.5-pro",
  messages,
});
```

No `if (provider === "anthropic") { ... } else { ... }` branches. No per-provider SDK updates.

### 2. A provider outage takes your feature down

OpenAI had multiple multi-hour outages in 2025. So did Anthropic. Every provider has bad days. If your code hardcodes one SDK, the only failover path is "retry and hope."

A gateway can reroute to a healthy provider within the same request. If `openai/gpt-4o` returns 503, the gateway tries `azure/gpt-4o` next, transparently, before your user sees an error. Uptime stops being a provider decision and starts being a routing decision.

### 3. You can't answer "what did that cost?"

With the direct API, cost lives in three places: the token counts in the response, the provider's billing console, and whatever spreadsheet someone is updating monthly. You can usually reconstruct total spend, but "how much did this feature cost last week?" or "which customer's traffic is driving the bill?" takes an afternoon of work.

A gateway tags every request with your metadata (project, user ID, feature) and gives you per-request cost out of the box. "Customer X's chatbot is doing 40x the tokens of the average" is a dashboard view, not a query you have to write.

### 4. Your prompts are stable but you're still paying full price

If you're sending the same system prompt to a FAQ bot 50,000 times a day, you're paying the full tokenization cost 50,000 times. Provider prefix caching helps on newer models; exact-match response caching kills the bill entirely.

You can roll your own cache — a Redis instance, some hash logic, a wrapper function. Or turn caching on with a toggle. On repetitive workloads, gateways see 30–90% cache hit rates. Every hit costs nothing. See [prompt caching explained](/blog/prompt-caching-explained).

### 5. You have compliance or auditability requirements

SOC 2, ISO 27001, HIPAA-adjacent, or an enterprise customer asking "who in your company accessed this prompt?" — any of those put you in the business of logging every LLM request, every user, every action, with retention and tamper-evidence. Building that is a quarter of engineering work. Gateways ship it: 90-day audit logs, security events, guardrail violations, full request history.

### 6. You're about to roll your own router

If your codebase has a file called `llm-client.ts` or `ai-provider.ts` that's started growing — fallback logic, retry logic, provider selection, API key management, cost tracking — you're building a gateway. That's fine if gateway-building is the product. If it isn't, you're spending engineering cycles on non-differentiated infrastructure.

## Direct API vs Gateway: Side by Side

| Concern                     | Direct API                        | LLM Gateway                               |
| --------------------------- | --------------------------------- | ----------------------------------------- |
| Setup                       | SDK install                       | SDK install + base URL change             |
| Multiple providers          | One adapter per provider          | One API, 300+ models                      |
| Failover on outage          | Retry same provider               | Reroute to healthy provider automatically |
| Cost tracking               | Provider console + spreadsheet    | Per-request, tagged, in dashboard         |
| Caching                     | Roll your own                     | Toggle in project settings                |
| Smart routing (price/perf)  | Manual                            | Weighted scoring, always on               |
| Audit logs                  | DIY                               | Built in, 90-day retention                |
| Guardrails (PII, injection) | External service                  | Built in, configurable per rule           |
| New models                  | Provider SDK update + code change | Available within ~48 hours, no deploy     |
| Lock-in                     | High (provider-specific code)     | Low (OpenAI-compatible on top of any)     |

## "But Isn't a Gateway Another Point of Failure?"

A fair question. Three honest answers:

1. **Gateways reduce total failure surface, not increase it.** A well-run gateway with multi-provider failover has higher effective uptime than any single provider it routes to. LLM Gateway's managed tier runs 99.9% availability; behind it, the routing layer shifts load to whichever provider is healthy.
2. **You can self-host.** LLM Gateway is AGPLv3 open source. Run it on your own infrastructure and the gateway and your app live or die together — no external dependency.
3. **The escape hatch is trivial.** Because the gateway is OpenAI-compatible, going back to direct APIs is the same two-line change as adopting it. You're not locked in.

## Migration Is Two Lines

```diff
- const client = new OpenAI({
-   apiKey: process.env.OPENAI_API_KEY,
- });
+ const client = new OpenAI({
+   baseURL: "https://api.llmgateway.io/v1",
+   apiKey: process.env.LLM_GATEWAY_API_KEY,
+ });
```

Your existing `chat.completions.create()` calls don't change. Model IDs that you already use (`gpt-5`, `gpt-4o`) work directly. Add a provider prefix (`anthropic/claude-opus-4-6`) to reach a different provider without any other code change.

Using the Vercel AI SDK? Swap the provider import:

```diff
- import { openai } from "@ai-sdk/openai";
+ import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
+ const llmgateway = createLLMGateway({ apiKey: process.env.LLM_GATEWAY_API_KEY });
```

## A Decision Framework

Ask three questions:

1. **Will you ever call more than one provider?** If yes, a gateway pays for itself the moment you add the second.
2. **Does a provider outage meaningfully hurt your business?** If yes, you need failover, which means a gateway or a custom router (a gateway with worse features).
3. **Can you answer "what does this cost per customer" in under 30 seconds?** If no, you need per-request observability, which means a gateway or an analytics project.

Zero yeses: stay on the direct API. You're fine.

One yes: a gateway is probably already the lower-effort option.

Two or three yeses: you're building the gateway either way. Use one that exists.

## TL;DR

- Start with the direct API. Don't add infrastructure you don't need.
- When you add a second provider, need failover, or need per-request cost visibility, a gateway stops being optional.
- An OpenAI-compatible gateway means two-line adoption and two-line exit. Lock-in is near zero.
- LLM Gateway is open source, self-hostable, and has a free tier. Try it when you're ready.

**[Try LLM Gateway free](/signup)** | **[How we handle failover](/blog/how-we-handle-llm-provider-failover)** | **[Why your AI app needs a gateway](/blog/why-your-ai-app-needs-a-gateway)**
