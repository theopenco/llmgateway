---
id: blog-llm-gateway-vs-portkey
slug: llm-gateway-vs-portkey
date: 2026-05-26
title: "LLM Gateway vs Portkey: An Honest Comparison"
summary: "Looking for a Portkey alternative? A straightforward comparison of LLM Gateway and Portkey — features, pricing, deployment, and trade-offs — so you can pick the right AI gateway for your stack."
categories: ["Guides"]
---

If you're shopping for an AI gateway, Portkey shows up fast — and for good reason. It's a mature platform with a unified API, deep observability, and one of the better prompt-management stories on the market. If you've landed here looking for a **Portkey alternative**, this post lays out where LLM Gateway and Portkey overlap, where they differ, and which one fits which team.

We built LLM Gateway, so we're biased. We'll still tell you where Portkey is the better call.

## The Quick Version

| Feature                  | LLM Gateway                                           | Portkey                                                  |
| ------------------------ | ----------------------------------------------------- | -------------------------------------------------------- |
| Core model               | Unified gateway + dashboard, all-in-one               | AI gateway + LLMOps platform (observability/prompts)     |
| Models                   | 300+ models, 25+ providers                            | 1,600+ models, 250+ providers (vendor claim)             |
| API compatibility        | OpenAI-compatible                                     | OpenAI-compatible                                        |
| Deployment               | Managed cloud or self-hosted (1 Docker image)         | Managed cloud; open-source gateway; enterprise self-host |
| Open source              | Full platform (AGPLv3)                                | Gateway/router only (MIT); platform is proprietary       |
| Bring Your Own Keys      | Yes (0% gateway markup)                               | Yes (virtual keys)                                       |
| Smart routing            | Weighted scoring (uptime, throughput, price, latency) | Conditional routing + load balancing (config-based)      |
| Auto retry & failover    | Yes (up to 2 retries, transparent)                    | Yes (retries, fallbacks)                                 |
| Response caching         | Built-in (Redis, 10s to 1 year TTL)                   | Simple + semantic caching                                |
| Guardrails               | Yes (prompt injection, PII, jailbreak, secrets)       | Yes (40+ guardrails, partner integrations)               |
| Prompt management        | Via Playground; no versioned registry                 | Yes — templates, versioning, deployments (standout)      |
| Analytics dashboard      | Per-request cost, latency, cache hit rate             | Deep observability, 40+ metrics, traces, OpenTelemetry   |
| Image & video generation | Yes (gpt-image, Gemini, Veo, Seedream, Qwen)          | Limited                                                  |
| AI SDK provider          | Yes (`@llmgateway/ai-sdk-provider`)                   | Via OpenAI-compatible client                             |
| Pricing model            | Free (self-host) or 5% platform fee / BYOK (0% fee)   | Free tier; usage/seat-based paid tiers; enterprise       |

## Where LLM Gateway Wins

### One Platform Instead of a Gateway Plus a Suite

Portkey is two things bolted together well: an **AI gateway** (routing, caching, fallbacks) and an **LLMOps platform** (observability, prompt management, analytics). That's powerful, but it also means more surface area — more concepts, more configuration, more to learn before you ship your first request.

LLM Gateway is a single platform. The proxy, dashboard, caching, routing, guardrails, audit logs, and billing are one product with one mental model. You point the OpenAI SDK at it and the observability is already there:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});
```

### Self-Host the Whole Thing, Not Just the Router

Portkey's **gateway** is open source (MIT) and you can run it yourself. But the parts most teams actually want — observability, prompt management, analytics, governance — live in the proprietary hosted platform. Self-hosting Portkey's full stack is an enterprise arrangement.

LLM Gateway is open source under AGPLv3 in its entirety — gateway, dashboard, worker, and all. One Docker command gets you the complete platform on your own infrastructure:

```bash
docker run -d \
  --name llmgateway \
  -p 3002:3002 -p 4001:4001 -p 4002:4002 \
  -e AUTH_SECRET="your-secret" \
  -e GATEWAY_API_KEY_HASH_SECRET="your-hash-secret" \
  ghcr.io/theopenco/llmgateway-unified:latest
```

If "run the whole platform ourselves, no proprietary control plane" is a hard requirement, that's the clearest difference between the two.

### Routing You Can See Into

Portkey's routing is config-driven: you define conditional routes, fallback chains, and load-balancing weights. It's flexible, but the weights are yours to set and maintain.

LLM Gateway's router scores every available provider for a model using the last 5 minutes of real metrics, then picks the winner automatically:

- **Uptime (50%)** — exponential penalty below 95%
- **Throughput (20%)** — tokens per second
- **Price (20%)** — weighted toward cheaper providers
- **Latency (10%)** — time to first token on streaming

Epsilon-greedy exploration (1% of requests) keeps the scores honest as conditions change, and every decision is logged with the scores and the winner — so routing adapts on its own instead of waiting for you to update a config.

### Image and Video Generation in the Same API

Portkey is focused on text and, increasingly, agents. If your roadmap includes generative media, LLM Gateway routes image and video models (gpt-image, Gemini, Veo, Seedream, Qwen) through the same key, billing, and dashboard as your chat traffic — no second integration.

### Transparent, Predictable Pricing

LLM Gateway is free to self-host. On the managed tier it's a flat 5% platform fee, or **bring your own provider keys and pay 0%**. No per-seat math, no log-retention tiers to reason about.

## Where Portkey Wins

### Prompt Management Is Genuinely Strong

This is Portkey's standout. Versioned prompt templates, a prompt registry, deployments, and a playground that ties into production — if your team treats prompts as first-class, versioned artifacts and wants non-engineers iterating on them, Portkey's prompt management is more mature than ours today. We expose a [Playground](https://chat.llmgateway.io) for testing, but not a full versioned prompt registry.

### Deep, Enterprise-Grade Observability

Portkey has invested heavily in observability: dozens of metrics, distributed traces, OpenTelemetry export, and integrations into the broader LLMOps ecosystem. LLM Gateway gives you per-request logs, cost, latency, and cache-hit analytics out of the box — which covers most teams — but if you need OTel pipelines and tracing that plugs into an existing observability stack, Portkey goes deeper.

### The Largest Model Catalog Claim

Portkey markets access to 1,600+ models across 250+ providers. LLM Gateway supports 300+ models across 25+ providers — curated and tested rather than maximal. If sheer breadth of long-tail providers is the deciding factor, Portkey advertises more.

### A Bigger Enterprise Governance Surface

For large orgs that need SSO, fine-grained RBAC, and compliance attestations as table stakes, Portkey's enterprise governance is well-developed and battle-tested at scale.

## Migration Is a Base URL Swap

Both gateways are OpenAI-compatible, so moving is mostly a configuration change:

```diff
- const baseURL = "https://api.portkey.ai/v1";  // Portkey
- // plus x-portkey-api-key / virtual-key headers
+ const baseURL = "https://api.llmgateway.io/v1";
+ const apiKey = process.env.LLM_GATEWAY_API_KEY;  // standard Bearer auth
```

LLM Gateway accepts both bare model IDs (routed automatically) and provider-prefixed ones (`openai/gpt-5.2`, `anthropic/claude-opus-4-5-20251101`), so most model names carry over directly. The main difference: you drop Portkey's virtual keys and `x-portkey-*` headers in favor of standard Bearer auth. Our [step-by-step Portkey migration guide](/migration/portkey) walks through Python, TypeScript, and cURL. Before you migrate, it's worth running your real workload through the [Token Cost Calculator](/token-cost-calculator) to see what the same traffic costs across providers.

## Who Should Use What

**Choose LLM Gateway if:**

- You want one all-in-one platform, not a gateway plus a separate LLMOps suite
- You need to self-host the _entire_ platform under an open-source license
- You want routing that scores providers and adapts automatically
- Image and video generation belong in the same API as chat
- You prefer flat, predictable pricing (5% or 0% with BYOK)

**Choose Portkey if:**

- Versioned prompt management is central to how your team works
- You need deep, OpenTelemetry-grade observability into an existing stack
- Access to the longest tail of providers is a hard requirement
- You're a large enterprise that needs a broad governance surface on day one

## The Bottom Line

Portkey is an excellent AI gateway with a strong LLMOps layer on top — especially if prompt management and deep observability are central to your workflow. LLM Gateway takes a different shape: one open-source platform where routing, caching, guardrails, analytics, and generative media are already wired together, self-hostable end to end, with pricing you can predict.

If you're evaluating a **Portkey alternative** because you'd rather have a single, fully open platform than a gateway-plus-suite, LLM Gateway is built for exactly that.

**[Try LLM Gateway free](/signup)** | **[Compare all features](/compare/portkey)** | **[See how we compare to LiteLLM](/blog/llm-gateway-vs-litellm)** | **[The 7 best AI gateways in 2026](/blog/best-ai-gateways)**
