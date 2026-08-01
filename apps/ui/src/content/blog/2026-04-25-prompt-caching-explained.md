---
id: blog-prompt-caching-explained
slug: prompt-caching-explained
date: 2026-04-25
title: "Prompt Caching Explained: How to Cut LLM Costs by 30–99%"
summary: "How LLM response caching actually works, where it helps, where it doesn't, and how to turn it on without rewriting your app."
categories: ["Guides"]
image:
  src: "/blog/prompt-caching-explained.png"
  alt: "Prompt Caching Explained: How to Cut LLM Costs by 30–99%"
  width: 1672
  height: 941
---

The cheapest LLM request is the one you don't send. If the same question shows up twice, there's no reason to pay twice — the model's answer hasn't changed, and the user doesn't care where it came from.

That's all prompt caching is. You store the response the first time, and serve it from memory the next time the same request comes in. Done well, it takes 30–99% off the bill and knocks latency down to sub-millisecond. Done badly, it serves stale or wrong answers.

This post covers both: what caching is, the two kinds you'll run into, where each works, and how to enable it on LLM Gateway without touching your code.

## What Caching Actually Does

A cache sits between your app and the LLM provider. When a request comes in:

1. The gateway hashes the request parameters (model, messages, temperature, tools, system prompt) into a cache key
2. If that key has a stored response, return it immediately — no provider call, no token cost
3. If not, forward the request, store the response, return it

The second request for the same question is a Redis lookup. It costs nothing. It returns in under a millisecond.

```
Without caching:           With caching (second hit):
─────────────────          ─────────────────────────
App  →  Provider           App  →  Gateway cache
~800ms, $0.01              <1ms, $0.00
```

## The Two Kinds of Caching

They both save money. They work differently and stack on each other.

### 1. Exact-match response caching (what LLM Gateway does)

Hash the full request, store the full response. Only hits when the request is **identical**: same model, same messages, same temperature, same tools.

- **Best for**: FAQ bots, classification, batch jobs, CI/dev environments, retry-after-error
- **Savings**: 100% of token cost on every hit. Typical workloads see 30–90% hit rates.
- **Latency**: Sub-millisecond. Works with streaming (the cached response is re-streamed).

### 2. Provider prefix caching (Anthropic, OpenAI, Google)

Cache the _prefix_ of a prompt — the system message, tool definitions, and any shared context — and reuse it across requests with different user messages at the end.

- **Best for**: Long system prompts, large tool catalogs, RAG over stable documents
- **Savings**: Typically 50–90% off the cached portion's input cost, not 100%
- **Latency**: Modest improvement (saves prefill compute, not the full round-trip)

They're complementary. LLM Gateway's exact-match caching catches repeat queries at the edge; provider prefix caching reduces cost on everything else. You don't have to choose.

## Concrete Math

Say you're running a customer support bot. 50,000 requests/day. Average 2,000 input tokens (system prompt + context), 500 output tokens. On GPT-4o that's:

```
Per request: (2000/1M)*$2.50 + (500/1M)*$10 = $0.005 + $0.005 = $0.010
Daily:       $500
Monthly:     $15,000
```

Add exact-match caching with a modest 40% hit rate (support questions repeat more than you'd think):

```
Cache hits:   20,000 × $0.000 = $0
Cache misses: 30,000 × $0.010 = $300
Daily:        $300  (40% saved)
Monthly:      $9,000  (saving $6,000/month)
```

Now layer provider prefix caching on the remaining misses — the 2,000-token system prompt is identical across all of them, so ~80% of input tokens get the cached rate:

```
Effective input cost per miss: roughly halves
Cache misses:  30,000 × ~$0.0075 = $225
Daily:         $225  (55% saved vs. baseline)
Monthly:       $6,750  (saving $8,250/month)
```

The numbers scale with volume. The cache infrastructure costs the same whether you do 100 requests or 100 million.

## Where Caching Doesn't Help

Caching is not free lunch. Don't enable it blindly:

- **Creative writing with high temperature.** You _want_ different outputs. A cache hit defeats the point.
- **Personalized responses.** If the prompt includes a user ID or history that changes per user, exact-match hits will be rare and the cache is mostly overhead.
- **Time-sensitive data.** "What's the current price of X?" with a 1-hour TTL serves yesterday's price. Use short TTLs or skip caching.
- **Streaming UX that expects variation.** Some UIs feel broken when the same prompt returns the exact same tokens instantly. Users can tell.

Rule of thumb: if your prompt sets `temperature: 0` or the task is factual/deterministic, cache it. Otherwise, don't.

## How to Turn It On (LLM Gateway)

No code changes required. Three steps in the dashboard:

1. **Enable Data Retention** — organization settings → set to "Retain All Data" (required because caching needs to store the payload)
2. **Enable Caching** — project settings → Preferences → toggle on
3. **Set the TTL** — anywhere from 10 seconds to 1 year. Default is 60 seconds. For FAQ-style workloads, try 1 hour; for truly static classification, try 30 days.

Requests just work. Cached responses show `cost: 0` in the usage dashboard so you can measure your hit rate directly.

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

// No special parameters needed — caching is automatic
// when enabled at the project level.
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Summarize: ..." }],
  temperature: 0,
});
```

Full docs: [docs.llmgateway.io/features/caching](https://docs.llmgateway.io/features/caching).

## Best Practices That Actually Move the Hit Rate

The difference between 10% and 70% hit rates is usually prompt hygiene, not the cache itself.

### 1. Set `temperature: 0` on deterministic work

Classification, extraction, routing, yes/no decisions — none of these benefit from sampling variation. `temperature: 0` maximizes cache hits and produces more reliable outputs anyway.

### 2. Normalize inputs before they hit the LLM

```typescript
// Bad: each of these is a unique cache key
"what are your hours?";
"What are your hours?";
"what are your hours? ";
"What are your hours";

// Good: normalize once, hit the cache every time
const normalized = input
  .trim()
  .toLowerCase()
  .replace(/[?.!]+$/, "");
```

Lowercase, trim whitespace, collapse punctuation. Small change, big hit-rate lift.

### 3. Keep timestamps out of prompts

A system prompt that includes `Current time: ${new Date()}` has a cache hit rate of 0. If the model doesn't actually need the exact time, remove it. If it does, round to the hour or day so cache keys match for a meaningful window.

### 4. Separate static and dynamic context

Put the stable instructions in the system prompt (benefits from provider prefix caching). Put the variable user input in the final user message. This structure is optimal for both types of caching.

### 5. Measure your hit rate

If you can't see your hit rate, you can't improve it. Every response in the LLM Gateway dashboard shows `cached: true/false` and the hit rate rolls up per model, project, and API key. A hit rate under 10% means caching isn't helping — either the workload is genuinely unique, or your prompts need normalizing.

## TL;DR

- Exact-match response caching is free money for repeat queries. Ship it.
- Provider prefix caching is free money for long system prompts and RAG. Ship it too.
- Don't cache creative, personalized, or time-sensitive work.
- Normalize inputs, use `temperature: 0` on deterministic tasks, and keep timestamps out of prompts.
- On LLM Gateway, enable caching in project settings. No code changes needed.

**[Try LLM Gateway free](/signup)** | **[Caching docs](https://docs.llmgateway.io/features/caching)** | **[Estimate your savings](/token-cost-calculator)**
