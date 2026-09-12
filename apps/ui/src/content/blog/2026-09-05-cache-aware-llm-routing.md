---
id: "blog-cache-aware-llm-routing"
slug: "cache-aware-llm-routing"
date: "2026-09-05"
updatedAt: "2026-09-12"
title: "Cache-Aware LLM Routing Learns Your Workload"
summary: "Cache-aware LLM routing learns cache-hit rates and token proportions from your project's recent model usage, so provider selection reflects the workload you actually run. Available automatically across plans, with explicit per-project overrides on Enterprise."
categories: ["Engineering", "Product"]
faqs:
  - question: "How does cache-aware LLM routing choose a provider?"
    answer: "For prompts estimated at 5,000 tokens or more, or when selecting a session's provider, routing blends cached and uncached input prices and weights output by the expected output-to-input token ratio. Both auto and price routing use these estimates. Providers without a cached input price use their full input price."
  - question: "When does routing start learning from my traffic?"
    answer: "Once a project's last 24 hours of model usage include at least 20 successful requests and 20,000 input tokens in eligible hourly aggregates. Until then, routing uses workload defaults. Learning works with payload retention disabled; buckets containing gateway response-cache hits are excluded."
  - question: "Do I need Enterprise for adaptive routing?"
    answer: "No. Adaptive pricing applies automatically across plans. Enterprise lets you override cacheHitRate and cacheOutputRatio per project; explicit overrides take precedence over observations and workload defaults."
  - question: "Will new usage data move an existing session?"
    answer: "A healthy, compatible session pin stays in place. Updated estimates inform future provider selections, including the replacement when a session needs to fall back."
image:
  src: "/blog/cache-aware-llm-routing.png"
  alt: "A glowing balance scale weighing coins against a memory-cache module on a circuit board, with light traces routing toward two provider chips"
  width: 1536
  height: 1024
---

A provider with the lowest input price can still cost more for an agent that reuses most of its prompt. Cache-read prices and the amount of output both affect that comparison. A fixed cache-hit assumption helps some workloads and misjudges others.

**LLM Gateway** now uses cache-aware LLM routing that learns from your project's recent model usage. It estimates the token mix your application sends and uses that estimate when comparing providers for the same model. This applies automatically across plans; Enterprise adds explicit per-project overrides.

## How Cache-Aware LLM Routing Prices a Request

For prompts estimated at **5,000 tokens or more**, or when choosing a session's provider, the token-price component is:

```text
price = (cachedInputPrice × h + inputPrice × (1 − h) + outputPrice × r) / 2
```

Here, `h` is the expected share of input tokens served from the provider's cache, and `r` is the output-to-input token ratio. A prompt-heavy agent loop puts more weight on cache-read prices. Traffic that produces long answers puts more weight on output prices.

Providers without a published `cachedInputPrice` use their full input price. Context-length tiers and time-based prices are resolved before scoring. The blend uses `cachedInputPrice`; separate explicit-cache read rates and cache-write charges are outside this estimate. It guides provider selection, while billing follows actual usage and applicable rates.

Both `routing: "auto"` and `routing: "price"` use the estimate. The default `auto` strategy also considers reliability and speed; `price` gives price a 90% relative weight and keeps a 10% uptime weight. The separate preference for cache support now defaults to zero, because cache-read savings already contribute to price.

## Learn From Your Project's Traffic

Routing uses the project's **last 24 hours of usage for that model** once eligible data includes at least **20 successful requests and 20,000 input tokens**.

- **Cache-hit rate:** each provider uses its own observed rate once it meets those thresholds, combining its regions. Otherwise, it uses the project's combined rate for that model.
- **Output-to-input ratio:** calculated across providers for that model within the project.

The lookup is cached for 60 seconds and reads hourly aggregates, so learning works with payload retention disabled. Buckets containing gateway response-cache hits are excluded because they cannot isolate upstream token usage. Projects using response caching may therefore keep using workload defaults longer.

If a lookup fails, routing uses previously cached observations when available, then configured estimates. An estimated hit rate does not guarantee that the next prompt will hit a provider's cache.

## Start With Defaults That Fit the Workload

Before enough history exists, routing starts with these estimates:

| Workload                              | Cached input | Output-to-input ratio |
| ------------------------------------- | ------------ | --------------------- |
| General API or unknown client         | 10%          | 20%                   |
| DevPass or a recognized coding client | 90%          | 2%                    |
| Chat organization                     | 50%          | 10%                   |

Recognized coding clients get the coding defaults even on regular API projects. A session ID alone does not identify coding traffic. Sufficient observations replace these starting assumptions.

Small requests outside a session continue to weight input and output prices equally. A session's opening request uses the expected workload mix even when its prompt is short, so its initial provider choice accounts for the conversation that follows.

## Keep Sessions on a Healthy Provider

New usage data informs future selections. A healthy, compatible session stays pinned to its provider and region, keeping its prompt cache warm. If the provider becomes unavailable, fails, or cannot serve the request, the gateway can select a replacement using the current routing score.

To let routing select a provider for a conversation, use a model ID without a provider prefix and reuse the same session ID on later turns:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-session-id: routing-example" \
  -d '{
    "model": "deepseek-v3.2",
    "routing": "price",
    "messages": [{"role": "user", "content": "Help me plan a code review."}]
  }'
```

Choose a model from the [live model directory](https://llmgateway.io/models). The [session docs](https://docs.llmgateway.io/features/sessions) cover session identifiers and fallback behavior.

## Override Estimates When You Need To

On the **Enterprise plan**, set `thresholds.cacheHitRate` and `thresholds.cacheOutputRatio` under **Project Settings → Routing**. An explicit value takes precedence over both observations and workload defaults for that field.

Setting them to `0` and `1`, respectively, restores list-price ranking for the token-price component. Enterprise projects can separately enable a cache-support preference under `auto`; `price` always gives that preference zero weight.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — let routing learn from your application's traffic
- **[Read the routing docs](https://docs.llmgateway.io/features/routing)** — scoring, learning thresholds, and overrides
- **[Track LLM usage and spend](/blog/track-llm-usage-spend-api)** — inspect your workload's tokens, cache hits, and costs
