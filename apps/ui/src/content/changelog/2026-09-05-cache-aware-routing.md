---
id: "95"
slug: "cache-aware-routing"
date: "2026-09-05"
title: "Cache-Aware Provider Selection"
summary: "Smart routing now ranks providers on what a cached workload actually pays. For prompts of 5,000 tokens or more, the price score blends each provider's cached input rate at an assumed 70% hit rate and weights output at a 20% output-to-input ratio, and context-length pricing tiers are resolved from the prompt size before scoring. Both assumptions are tunable per project on the Enterprise plan."
image:
  src: "/changelog/cache-aware-routing.png"
  alt: "A glowing routing junction splitting a light trace toward two provider chips beside a memory-cache module and a balance scale weighing coins on a circuit board"
  width: 1536
  height: 1024
---

Two providers can list the same model at the same input and output prices and still bill a cached workload very differently: one charges cache reads at 56% of its input price, the other at 16%. Routing used to rank both on list prices alone, so a cache-heavy agent loop could land on the provider that costs up to 2.6x more once the cache reads are billed. **Cache-aware provider selection** ranks on the price the workload will actually pay.

## The Price Routing Ranks On

For requests at or above the cache-relevance gate (`cachePromptTokens`, default 5,000 prompt tokens), the price component of the routing score becomes:

```
(cachedInputPrice × h + inputPrice × (1 − h) + outputPrice × r) / 2
```

| Threshold           | Default | Meaning                                                         |
| ------------------- | ------- | --------------------------------------------------------------- |
| `cachePromptTokens` | `5000`  | Prompt size from which cache pricing enters the ranking         |
| `cacheHitRate`      | `0.7`   | Assumed share of prompt tokens served from the provider's cache |
| `cacheOutputRatio`  | `0.2`   | Assumed output-to-input token ratio for large-prompt requests   |

Providers that do not publish a cached input price rank at their full input price, exactly as they bill. Peak and off-peak cached prices are respected. The blend covers implicit cache hits only: explicit-cache reads requested with `cache_control` are billed at a provider's separate `cacheReadInputPrice` where one exists and are not part of the ranking. Smaller prompts rank as before, and setting `cacheHitRate` to `0` and `cacheOutputRatio` to `1` returns the price component to list prices while the separate cache-support weight still applies.

The output ratio matters as much as the blend: at output parity, a cheaper output price swamps any cache difference, and large-prompt traffic is dominated by input tokens anyway. The defaults are asymmetric on purpose. Treating a one-shot large prompt as cached costs at most about 11% on the affected models; ranking a cached workload on list prices costs up to 160%.

## Pricing Tiers Resolved Before Scoring

Selection now also resolves context-length pricing tiers from the prompt-token estimate before ranking, with the same precedence billing uses: time-based pricing first, then the tier override by token count. Tiered mappings were previously ranked at their base rates regardless of prompt size.

Both thresholds live under **Project Settings → Routing** and are available on the **Enterprise plan**.

---

**[Routing docs →](https://docs.llmgateway.io/features/routing)** | **[Enterprise plans →](https://llmgateway.io/enterprise)**
