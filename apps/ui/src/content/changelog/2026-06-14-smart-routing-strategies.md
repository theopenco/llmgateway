---
id: "57"
slug: "smart-routing-strategies"
date: "2026-06-14"
title: "Routing Strategies: Cheapest, Fastest & Defaults"
summary: "Steer multi-provider routing with a new routing field — auto, price, throughput, or latency — per request or as a per-project default. Each strategy still falls back when the top pick has bad uptime."
image:
  src: "/changelog/smart-routing-strategies.png"
  alt: "Routing strategies on LLM Gateway: auto, price, throughput and latency"
  width: 1024
  height: 1024
---

When a model is served by more than one provider, the gateway scores them on price, reliability, speed, and cache support and picks the best. Now you can **bias that decision toward the one factor you care about** — without giving up the automatic fallback that keeps requests reliable.

## The `routing` field

Add `routing` to any chat completions request to choose the strategy:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v3.2",
    "messages": [{"role": "user", "content": "Hello!"}],
    "routing": "price"
  }'
```

| Strategy           | Behavior                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| `auto` _(default)_ | Full weighted score across price, uptime, throughput, latency, and cache. |
| `price`            | Strongly prefer the cheapest provider.                                    |
| `throughput`       | Strongly prefer the fastest-generating provider.                          |
| `latency`          | Strongly prefer the lowest time-to-first-token (streaming).               |

Each non-`auto` strategy still keeps a reliability floor: a provider with extremely bad uptime is skipped in favor of a healthy one, so `price` gives you the cheapest provider that actually works — not one that's effectively down.

## Set a per-project default

Don't want to pass the field on every request? Set a **default routing strategy** for the whole project under **Settings → Routing** in the dashboard. Requests that omit `routing` use the project default; an explicit `routing` on a request always wins.

## Works with coding plans

DevPass coding plans support `auto` and `price` (the cache-aware strategies that keep prompt caching effective). The dashboard greys out `throughput` and `latency` for those projects.

## No surprises for pinned providers

Strategies only affect multi-provider routing. Combining `routing` with a pinned provider — e.g. `openai/gpt-4o` — returns a `400` rather than silently doing nothing. And an explicit single-factor strategy disables random exploration, so selection stays deterministic.

---

**[Routing docs →](https://docs.llmgateway.io/features/routing#routing-strategy)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
