---
id: "80"
slug: "concurrent-request-limits"
date: "2026-08-22"
title: "Concurrent Request Limits and Overload Protection"
summary: "Every organization now has a fleet-wide budget of concurrent in-flight requests that scales with your trust tier — bounding the long-running streams a per-minute limit can't see. Over-budget requests get a retryable 429, and a momentarily saturated gateway sheds load with a 529 instead of queueing until it degrades."
image:
  src: "/changelog/concurrent-request-limits.png"
  alt: "Concurrent request limits: a circuit board with parallel request lanes flowing into a central gateway chip, some lanes held back by a glowing gate"
  width: 1536
  height: 1024
---

A per-minute rate limit can't see duration. Six hundred requests per minute sounds bounded — until each one streams for two minutes and holds 1,200 connections open at once. Long-lived agentic streams pile up in a way RPM budgets never notice, and one tenant's runaway parallelism can exhaust shared gateway capacity for everyone else. **Concurrent request limits** close that gap: each organization now has one fleet-wide budget of in-flight requests across all inference endpoints — chat completions, messages, responses, embeddings, moderations, rerank, OCR, images, speech, transcriptions, videos, and the AI SDK surface.

## How Slots Work

A slot is held for a request's full lifetime — including the entire duration of a streamed response — and freed the moment the response finishes or the connection closes. Slots free up continuously as requests complete, so there is no fixed window to wait out: a retry after a short backoff typically succeeds.

For pay-as-you-go organizations the ceiling scales with the same [trust tier](https://docs.llmgateway.io/resources/rate-limits) that already drives your per-minute limits and spend caps:

| Plan                    | Concurrent requests |
| ----------------------- | ------------------- |
| Regular (PAYG) — Tier 0 | 100                 |
| Regular (PAYG) — Tier 1 | 200                 |
| Regular (PAYG) — Tier 2 | 400                 |
| Regular (PAYG) — Tier 3 | 1,000               |
| Regular (PAYG) — Tier 4 | 2,000               |
| Dev plan                | 50                  |
| Chat plan               | 10                  |
| Enterprise              | 2,000               |

Requests over the budget are rejected with a retryable `429`:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 1

{
	"error": {
		"message": "Too many concurrent requests for this organization (limit: 100). Retry shortly, or reduce request concurrency.",
		"type": "rate_limit_error",
		"code": "rate_limit_exceeded"
	}
}
```

Unlike the per-minute limits, **Enterprise organizations are not exempt** — unbounded single-tenant concurrency exhausts shared capacity regardless of plan. They get the top-of-ladder ceiling instead, and can [contact us](mailto:contact@llmgateway.io) to raise it further.

## Overload Shedding (529)

The same release adds pod-level backpressure. When a gateway instance is momentarily at its own capacity, new inference requests are shed instantly with a `529` and `Retry-After: 1` — matching Anthropic's `529 Overloaded` — instead of queueing until the instance degrades. Health checks and `/v1/models` are never shed, so the rest of the fleet keeps absorbing traffic while the hot instance recovers.

|           | `429`                                            | `529`                                  |
| --------- | ------------------------------------------------ | -------------------------------------- |
| Cause     | Your organization exceeded its concurrency limit | The gateway is momentarily at capacity |
| Fix       | Reduce client-side parallelism, then retry       | Retry immediately with backoff         |
| Retryable | As soon as one of your in-flight requests ends   | Yes, within seconds                    |

Both responses carry `Retry-After` — respect it with exponential backoff and a spike passes through instead of failing.

---

**[Rate limits docs →](https://docs.llmgateway.io/resources/rate-limits)** | **[Contact us about Enterprise →](https://llmgateway.io/enterprise)**
