---
id: "95"
slug: "cache-aware-routing"
date: "2026-09-05"
title: "Adaptive Cache-Aware Provider Selection"
summary: "Routing learns cache-hit rates and output-to-input proportions from recent project/model usage to compare providers for large prompts and sessions. Available automatically across plans, with workload defaults before enough history exists and explicit overrides on Enterprise."
image:
  src: "/changelog/cache-aware-routing.png"
  alt: "A glowing routing junction splitting a light trace toward two provider chips beside a memory-cache module and a balance scale weighing coins on a circuit board"
  width: 1536
  height: 1024
---

**Updated September 12, 2026:** routing now learns from project usage.

The lowest input price can hide expensive cache reads, and one fixed cache-hit assumption cannot fit every workload. **Adaptive cache-aware provider selection** learns from your project's model usage to compare providers using the token mix your application sends.

## Price the Workload You Run

For prompts estimated at **5,000 tokens or more**, or when selecting a session's provider, both `auto` and `price` routing blend cached and uncached input prices and weight output by the expected output-to-input ratio.

Routing learns from the **last 24 hours** once eligible model usage reaches **20 successful requests and 20,000 input tokens**. A sufficiently sampled provider uses its own cache-hit rate across regions; otherwise it uses the project's combined rate for that model. The output ratio always comes from that model's combined project usage.

Before enough data exists, these workload estimates apply:

| Workload                              | Cached input | Output-to-input ratio |
| ------------------------------------- | ------------ | --------------------- |
| General API or unknown client         | 10%          | 20%                   |
| DevPass or a recognized coding client | 90%          | 2%                    |
| Chat organization                     | 50%          | 10%                   |

Recognized coding clients use the coding defaults on regular API projects too. A session ID alone does not identify coding traffic.

## Preserve Cache Locality and Controls

- **Sessions:** the opening request uses workload estimates even with a short prompt. Healthy, compatible pins stay in place as new observations arrive.
- **Retention:** learning reads hourly aggregates and works with payload retention disabled. Buckets containing gateway response-cache hits are excluded.
- **Availability:** usage lookups are cached for 60 seconds, with previously cached observations used on failure before falling back to configured estimates.
- **Pricing:** context-length tiers and time-based prices apply before scoring. Providers without a cached input price use their full input price; separate explicit-cache read rates and cache-write charges are outside the estimate.
- **Cache preference:** the separate cache-support weight now defaults to zero, because cache-read savings already count toward price. Small requests outside sessions continue to weight input and output equally.

Adaptive pricing is automatic across plans. **Enterprise** projects can override `thresholds.cacheHitRate` and `thresholds.cacheOutputRatio` under **Project Settings → Routing**; explicit values take precedence over observations and defaults. Setting them to `0` and `1` restores list-price ranking for the token-price component. Cache-hit estimates guide routing and do not guarantee a cache hit or savings on an individual request.

---

**[Routing docs →](https://docs.llmgateway.io/features/routing)** | **[Read the blog post →](https://llmgateway.io/blog/cache-aware-llm-routing)**
