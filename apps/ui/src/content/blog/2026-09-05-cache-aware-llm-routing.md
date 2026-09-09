---
id: "blog-cache-aware-llm-routing"
slug: "cache-aware-llm-routing"
date: "2026-09-05"
title: "Why LLM Routing Has to Price Prompt Caching"
summary: "Ranking providers on list prices picks the wrong one for cache-heavy workloads: two deployments of the same model can differ by 2.6x on the invoice once cache reads are billed. Here is how LLM Gateway's routing now blends cached input prices into provider selection, the math behind the defaults, and how to tune them."
categories: ["Engineering"]
faqs:
  - question: "Does LLM Gateway route based on prompt caching costs?"
    answer: "Yes. For prompts of 5,000 tokens or more, smart routing ranks each provider on a blended price that assumes a 70% cache-hit rate on input tokens and a 20% output-to-input token ratio, using the provider's published cached input price. Providers without a cached input price are ranked at their full input price, which is also how they bill."
  - question: "Can I turn cache-aware routing off?"
    answer: "Yes. Per-project routing thresholds are available on the Enterprise plan. Setting cacheHitRate to 0 and cacheOutputRatio to 1 puts the price component back on list prices, although the separate cache-support weight still applies to large prompts. Raising cacheHitRate makes routing favor providers with cheap cache reads more strongly."
  - question: "Why does the output-to-input ratio matter for routing?"
    answer: "Weighting output at parity with input lets a slightly cheaper output price cancel out a large cache-read difference, because output prices are several times higher than input prices. Large-prompt traffic is dominated by input tokens, so routing weights output at 20% of input for cache-relevant requests."
image:
  src: "/blog/cache-aware-llm-routing.png"
  alt: "A glowing balance scale weighing coins against a memory-cache module on a circuit board, with light traces routing toward two provider chips"
  width: 1536
  height: 1024
---

Every LLM router advertises that it picks the cheapest provider. Most of them, including ours until last week, rank providers on list prices: average the input and output rates, add uptime and latency, pick the lowest score. That is the right answer for a one-shot request. It is the wrong answer for the workloads that actually dominate a gateway's traffic in 2026: agent loops that re-send a 40K-token prefix on every turn and pay for most of it at the **cached input price**.

This post is about the bug in that ranking, why the obvious fix does not work on its own, and what **LLM Gateway** routing does now.

## The bug, with real numbers

A user filed an issue with the catalogue's own data. Kimi K2.5 was served by two providers that both listed it at competitive input and output prices. On list prices, provider A won the election. But provider A billed a cache read at 55.6% of its input price, while provider B billed it at 15.6%. For an agent that hits the cache on most of its prompt, the "cheaper" provider was up to 2.6x more expensive on the invoice.

Nothing was wrong with billing. The cost engine already charged cache reads at each provider's `cachedInputPrice`, or at its explicit-cache `cacheReadInputPrice` where a provider publishes a separate rate for `cache_control` reads. The ranking simply never read that field, so routing optimised a number the customer never paid.

## Why blending the input price is not enough

The obvious fix is to replace `inputPrice` in the ranking with a blend: assume some hit rate `h` and rank on `cachedInputPrice·h + inputPrice·(1−h)`. We tried exactly that first, and it did not flip the headline case.

The reason is the output term. The old score averaged input and output at parity, and output prices run several times higher than input prices. Provider A's slightly cheaper output price swamped the entire cache-read difference; the break-even hit rate came out above 100%. For large prompts, output parity is fiction: a 40K-token prompt that produces a 400-token tool call has an output-to-input ratio of 1%, not 100%.

So the fix has two parts, and both are gated to cache-relevant requests, meaning prompts at or above the existing cache threshold of 5,000 estimated tokens:

```
price = (cachedInputPrice·h + inputPrice·(1−h) + outputPrice·r) / 2
```

| Threshold           | Default | Meaning                                                    |
| ------------------- | ------- | ---------------------------------------------------------- |
| `cachePromptTokens` | 5000    | Prompt size from which the cached price enters the ranking |
| `cacheHitRate`      | 0.7     | Assumed share of prompt tokens served from cache (`h`)     |
| `cacheOutputRatio`  | 0.2     | Assumed output-to-input token ratio (`r`)                  |

Below the threshold, nothing changed. Providers without a published cached input price are ranked at their full input price, which is exactly how they bill. The blend uses the implicit cached input price only: explicit-cache reads requested with `cache_control` are billed at a provider's `cacheReadInputPrice` where one exists, and that rate is outside the ranking. Peak and off-peak cached prices are respected where a provider has time-based pricing.

## A worked example

Take two hypothetical deployments of the same model:

| Provider | Input | Cached input | Output |
| -------- | ----- | ------------ | ------ |
| A        | $0.55 | $0.30        | $2.20  |
| B        | $0.60 | $0.10        | $2.50  |

On list prices, A wins: `(0.55 + 2.20) / 2 = 1.375` against B's `(0.60 + 2.50) / 2 = 1.55`.

With the defaults for a 20K-token prompt, B wins: `(0.10·0.7 + 0.60·0.3 + 2.50·0.2) / 2 = 0.375` against A's `(0.30·0.7 + 0.55·0.3 + 2.20·0.2) / 2 = 0.4075`. B is the provider whose invoice is lower for a cached workload, which is the whole point.

## Why the defaults are asymmetric

A 70% hit rate is an assumption, and a large one-shot prompt will not hit any cache. So we looked at the cost of being wrong in each direction across the affected models in the catalogue:

- Treat a one-shot large prompt as cached and route it to the cache-cheap provider, and you overpay by at most about 11%.
- Treat a cached workload as one-shot and route it on list prices, and you overpay by up to 160%.

Large prompts are also precisely where prompt caching gets used. The defaults lean toward the cheap mistake.

## Pricing tiers, while we were there

The same ranking had a second blind spot: providers with context-length pricing tiers were always ranked at their base rates, even for prompts that would bill in a higher tier. Selection now resolves the tier from the prompt-token estimate before scoring, with the same precedence billing uses (time-based pricing first, then the tier override). This applies to every request with a prompt estimate, not only cache-relevant ones.

## What we deliberately did not change

- The model-level price shown on the models directory is still the plain list price. Blending a hypothetical hit rate into an advertised number would misrepresent it.
- The binary cache-support weight in the score stays. It answers "does this provider cache at all", while the blended price ranks among providers that do. They compose.

## Tuning it

Both thresholds live under **Project Settings → Routing** on the Enterprise plan. Teams that know their workload can set `cacheHitRate` from their own cache statistics, which the dashboard and the `get-usage` MCP tool report per period. Setting `cacheHitRate: 0` and `cacheOutputRatio: 1` returns the price component to list prices; the separate cache-support weight described above still applies, so selection is not a pure list-price ranking.

## Getting started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** and let smart routing pick the provider for a cached workload
- **[Read the routing docs](https://docs.llmgateway.io/features/routing)** for the full scoring model, weights, and per-project overrides
- **[How caching works across providers](/blog/llm-data-retention)** covers what a cache read is and where the data lives

<BlogCta variant="gateway" location="bottom" />
