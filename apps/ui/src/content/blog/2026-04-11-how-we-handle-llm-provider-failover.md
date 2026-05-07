---
id: blog-how-we-handle-llm-provider-failover
slug: how-we-handle-llm-provider-failover
date: 2026-04-11
title: "How We Handle LLM Provider Failover at Scale"
summary: "A deep dive into the routing, retry, and failover systems that keep LLM Gateway reliable when upstream providers go down."
categories: ["Engineering"]
image:
  src: "/blog/how-we-handle-llm-provider-failover.png"
  alt: "How We Handle LLM Provider Failover at Scale"
  width: 1408
  height: 768
---

LLM providers go down more than you'd expect. OpenAI has had multiple major outages. Anthropic has rate limit spikes. Google Vertex has regional availability issues. When you're routing millions of requests, every provider will fail eventually.

This post is a deep dive into how LLM Gateway handles these failures transparently — so your application stays up even when providers don't.

## The Problem

When you integrate directly with a single LLM provider, their downtime is your downtime. Your error handling looks something like:

```typescript
try {
  const response = await openai.chat.completions.create({ ... });
} catch (error) {
  // Now what? Show the user an error? Queue the request? Cry?
}
```

You could add retry logic. Maybe a second provider as a backup. But now you're maintaining routing code, health checks, and failover logic — and that code needs to handle streaming responses, partial failures, rate limits, and authentication errors differently.

That's the gateway's job.

## Architecture Overview

Every request to LLM Gateway goes through a multi-stage pipeline:

```
Request
  ↓
Route Selection (smart routing algorithm)
  ↓
Provider Attempt #1
  ├─ Success → Response
  └─ Server error → Retry
       ↓
  Provider Attempt #2
  ├─ Success → Response
  └─ Server error → Retry
       ↓
  Provider Attempt #3
  ├─ Success → Response
  └─ Failure → Error to client
```

Up to 2 retries on different providers, all within the same API call. The client sees a normal response — it doesn't know or care that the first provider failed.

## Smart Routing: Picking the Right Provider

When a request comes in for a model like `gpt-4o` without a provider prefix, the gateway needs to decide which provider to use. We don't do round-robin. We don't pick randomly. We score every available provider using a weighted algorithm based on real-time metrics from the last 5 minutes.

### The Scoring Formula

Four factors, weighted:

| Factor         | Weight | What It Measures                     |
| -------------- | ------ | ------------------------------------ |
| **Uptime**     | 50%    | Success rate of recent requests      |
| **Throughput** | 20%    | Tokens per second generation speed   |
| **Price**      | 20%    | Cost per token                       |
| **Latency**    | 10%    | Time to first token (streaming only) |

For non-streaming requests, the latency weight is redistributed proportionally to the other factors — time to first token doesn't matter when you're waiting for the complete response anyway.

All metrics are normalized so the scoring is fair across providers with different scales.

### The Uptime Penalty

Uptime gets the highest weight (50%) because reliability is the most important factor for production workloads. But linear weighting isn't aggressive enough. A provider at 80% uptime is significantly worse than one at 95%, and the scoring should reflect that.

We use an exponential penalty for providers below 95% uptime:

| Uptime  | Penalty        |
| ------- | -------------- |
| 95–100% | 0 (no penalty) |
| 90%     | ~0.07          |
| 80%     | ~0.62          |
| 70%     | ~1.73          |
| 50%     | ~5.61          |

This means a provider having a bad 5 minutes gets aggressively deprioritized. Small fluctuations (95%+) have minimal impact. Major issues (< 80%) effectively remove the provider from rotation.

### The Cold Start Problem

New providers and providers that haven't received traffic recently have no metrics. With pure exploitation (always pick the best-scoring provider), they'd never get traffic, and we'd never learn their current performance.

We solve this with epsilon-greedy exploration: 1% of requests are randomly routed to a non-optimal provider. This ensures:

- All providers periodically receive traffic
- New providers can prove their reliability
- The system detects when a previously slow provider improves
- Metrics stay fresh across all options

1% is low enough to have negligible impact on overall reliability while keeping the system adaptive.

## Retry Logic: What Triggers a Retry

Not all errors should trigger a retry. Retrying a bad request just wastes time. We retry on **server-side failures only**:

**Retried:**

- 5xx errors (500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable)
- Timeouts (upstream provider took too long)
- Connection failures (network errors, DNS failures)

**Not retried:**

- 4xx client errors (400 Bad Request, 401 Unauthorized, 422 Unprocessable Entity)
- Content filter responses (Azure ResponsibleAI blocks, etc.)

This distinction is critical. A 400 Bad Request means the request itself is malformed — retrying on a different provider won't help. A 503 means the provider is temporarily unavailable — trying another provider is exactly the right move.

### Streaming Retries

The tricky part is retrying streaming requests. If a provider starts streaming a response and then fails mid-stream, we can't seamlessly switch to another provider — the client has already received partial data.

Retries for streaming requests happen at the connection level. If the provider fails before sending any data (connection error, immediate 5xx), we retry transparently. If data has already been sent to the client, the error propagates.

## Low-Uptime Protection

Even when you explicitly request a specific provider (e.g., `openai/gpt-4o`), we still check its recent uptime. If the provider's uptime in the last 5 minutes is below 90%, we automatically route to the best available alternative.

```
Request for openai/gpt-4o
  ↓
Check OpenAI uptime → 85% (below threshold)
  ↓
Route to azure/gpt-4o instead (95% uptime)
  ↓
Response from Azure
```

This protects your application even when you've hardcoded a provider. If no alternative provider is available for that model, we still try the originally requested one — a degraded provider is better than no provider.

### Opting Out

Sometimes you need to test a specific provider or debug an issue, and automatic failover gets in the way. The `X-No-Fallback` header disables this protection:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-No-Fallback: true" \
  -d '{"model": "openai/gpt-4o", "messages": [...]}'
```

With this header, the request goes to the specified provider regardless of its uptime score. Retries can still happen within the same provider if multiple API keys are configured.

## Multi-Key Load Balancing

For self-hosted deployments (or our own infrastructure), you can configure multiple API keys per provider:

```bash
LLM_OPENAI_API_KEY=sk-key1,sk-key2,sk-key3
```

The gateway tracks the health of each individual key. If `sk-key1` starts returning 500s, it's temporarily skipped. If it returns 401/403 (authentication failure), it's permanently blacklisted until restart.

This gives you load balancing within a single provider — spreading requests across keys to avoid rate limits — in addition to cross-provider failover.

For providers like Google Vertex that require additional configuration per key, related values are index-matched:

```bash
LLM_GOOGLE_VERTEX_API_KEY=key1,key2,key3
LLM_GOOGLE_CLOUD_PROJECT=project-a,project-b,project-c
LLM_GOOGLE_VERTEX_REGION=us-central1,europe-west1,asia-east1
```

When the gateway selects `key2`, it automatically uses `project-b` and `europe-west1`.

## Region-Aware Routing

Some providers expose the same model in multiple regions. The gateway supports two modes:

- `provider/model` — Scores all eligible regions and picks the best one
- `provider/model:region` — Pins to a specific region

For example, `alibaba/deepseek-v3.2` lets the gateway choose the best Alibaba region based on the same uptime/throughput/latency/price scoring. `alibaba/deepseek-v3.2:cn-beijing` forces the Beijing region.

## Routing Transparency

Every request includes full routing metadata in the activity logs:

```json
{
  "routing": [
    {
      "provider": "openai",
      "model": "gpt-4o",
      "status_code": 500,
      "error_type": "server_error",
      "succeeded": false
    },
    {
      "provider": "azure",
      "model": "gpt-4o",
      "status_code": 200,
      "error_type": "none",
      "succeeded": true
    }
  ]
}
```

Failed attempts that were successfully retried are marked with `retried: true` and linked to the successful log entry. In the dashboard, these show a "Retried" badge so you can see exactly what happened.

This transparency is important. You should always be able to understand _why_ a request was routed to a particular provider and what happened along the way.

## The Self-Healing Loop

All of these systems work together to create self-healing behavior:

1. Provider starts failing → uptime score drops
2. Exponential penalty kicks in → fewer requests routed there
3. Requests automatically shift to healthy providers
4. Failed requests are retried transparently on alternatives
5. Provider recovers → uptime score improves
6. Epsilon-greedy exploration sends test traffic
7. Metrics confirm recovery → normal routing resumes

No manual intervention. No alerts to wake up to. No config changes. The system adapts to provider issues and recovers when they do.

## What This Means for Your Application

When you use LLM Gateway, you get a single integration point that:

- Automatically picks the best provider based on real-time performance
- Retries failed requests on alternative providers within the same API call
- Routes around degraded providers before they cause errors
- Balances load across multiple API keys
- Logs every routing decision for debugging
- Self-heals without manual intervention

Your application code stays simple:

```typescript
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

Everything else happens at the gateway layer.

**[Try LLM Gateway free](/signup)** | **[Read the routing docs](https://docs.llmgateway.io/features/routing)** | **[Self-host with Docker](https://docs.llmgateway.io/self-host)**
