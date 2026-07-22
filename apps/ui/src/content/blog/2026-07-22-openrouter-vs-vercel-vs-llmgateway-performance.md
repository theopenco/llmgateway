---
id: "blog-openrouter-vs-vercel-vs-llmgateway-performance"
slug: "openrouter-vs-vercel-vs-llmgateway-performance"
date: "2026-07-22"
title: "OpenRouter vs Vercel vs LLMGateway Performance"
summary: "We measured AI gateway performance with an open-source TTFT benchmark: 75 cold + 75 warm interleaved runs of claude-haiku-4.5 against LLM Gateway and OpenRouter, with phase-by-phase timings and raw data published. LLM Gateway reached first token ~35% faster cold and ~34% faster warm, and here is exactly how to reproduce the numbers."
categories: ["Engineering"]
image:
  src: "/blog/openrouter-vs-vercel-vs-llmgateway-performance.png"
  alt: "Glossy circuit board with a glowing stopwatch on the central chip and light traces racing toward it, representing an AI gateway latency benchmark"
  width: 1536
  height: 1024
---

Every AI gateway adds a hop between your app and the model. The question that matters is what that hop costs at the moment your user is staring at a blank chat window: the time to first token. Most gateway latency debates skip the measurement and argue architecture — so we measured it.

We ran an open-source TTFT benchmark against **LLM Gateway** and OpenRouter, interleaved, from the same machine, on the same model. The medians over 75 runs each: LLM Gateway got the first content token in 906ms on a cold connection and 814ms on a warm one. OpenRouter took 1392ms and 1232ms. That is roughly 35% faster cold and 34% faster warm, with zero errors across the 300 measured runs — 450 HTTP requests in total, counting the throwaway warm-up call that precedes each warm measurement, every one of which returned HTTP 200. The raw per-run data is [published in full](https://gist.github.com/smakosh/0ca360230fb267d375b91dbd50548b67).

## How we measured AI gateway performance

We used [ai-gateways-benchmark](https://github.com/rbadillap/ai-gateways-benchmark), an open-source script by Ronny Badilla that recently made the rounds comparing Vercel AI Gateway, OpenRouter, and Cloudflare AI Gateway. It is Python stdlib only — raw sockets, no HTTP library — and it times every phase of a streaming request separately: DNS, TCP connect, TLS handshake, TTFB (request sent to first response byte), and TTFT (request sent to first content token in the SSE stream).

That separation is the point. "Gateway latency" claims usually conflate connection cost, edge proximity, and actual routing overhead. This tool splits them apart.

Our setup, on July 22, 2026:

- **Same model on both gateways**: claude-haiku-4.5, streaming, `max_tokens: 16`, identical prompt
- **75 cold + 75 warm runs per gateway**, interleaved round-robin so time-of-day drift hits both equally
- **Cold** = a fresh connection paying full DNS + TCP + TLS with a new TLS context (no session resumption)
- **Warm** = a second request on an already-open socket — the connection-pool case your production traffic mostly lives in
- One residential vantage point, zero errors on either gateway across all 450 HTTP requests (including warm-ups)

## Results: LLM Gateway vs OpenRouter

Medians of n=75 per cell. Cold TTFT is end-to-end: DNS + TCP + TLS + time to first content token — what a short-lived process pays.

| Medians             | TTFB (cold) | TTFT (cold) | TTFT (warm) |
| ------------------- | ----------- | ----------- | ----------- |
| LLM Gateway         | 201ms       | 906ms       | 814ms       |
| OpenRouter (direct) | 1369ms      | 1392ms      | 1232ms      |

The spread, as median with p10–p90 range:

| Metric        | LLM Gateway    | OpenRouter       |
| ------------- | -------------- | ---------------- |
| Cold TTFB     | 201 (194–240)  | 1369 (979–1643)  |
| Cold e2e TTFT | 906 (803–1380) | 1392 (1002–1675) |
| Warm TTFB     | 176 (171–193)  | 1229 (924–1500)  |
| Warm TTFT     | 814 (673–1379) | 1232 (924–1501)  |

Two things stand out beyond the medians. LLM Gateway's p90 cold TTFT (1380ms) came in below OpenRouter's median — the slow tail of one distribution beat the middle of the other. And LLM Gateway's warm TTFB barely moves: 171–193ms across the p10–p90 range, which is the stability you want under a production connection pool.

## Where the time goes

The phase breakdown shows the overhead is not in the connection:

| Gateway     | DNS | TCP  | TLS  | TTFB   | TTFT (request) |
| ----------- | --- | ---- | ---- | ------ | -------------- |
| LLM Gateway | 3.2 | 20.9 | 40.2 | 200.9  | 829.5          |
| OpenRouter  | 3.4 | 7.2  | 12.7 | 1369.4 | 1369.8         |

OpenRouter's edge actually wins the handshake — 13ms TLS vs our 40ms. It loses everything after the request is sent.

One honest caveat on the TTFB column: it flatters LLM Gateway for an architectural reason. Our gateway starts the response stream in about 200ms, before the first upstream token arrives. OpenRouter holds its first byte until the first token is ready, so its TTFB equals its TTFT on every single run. TTFB tells you who streams headers early; TTFT is the number your users feel, and it is the honest headline of this post.

A second caveat: each gateway ran its default routing for this model. OpenRouter picks its upstream per request (a request we inspected was served via Amazon Bedrock), while our runs were pinned to Anthropic's API. Both are what you get out of the box, but they are different upstreams.

## How Vercel AI Gateway compares

We did not benchmark Vercel ourselves. The benchmark's author published his own run of the same script — from his vantage point, on a different date — comparing Vercel AI Gateway, OpenRouter, and Cloudflare AI Gateway proxying OpenRouter:

| His run (medians of n=5) | TTFB   | TTFT (cold) | TTFT (warm) |
| ------------------------ | ------ | ----------- | ----------- |
| Vercel AI Gateway        | 785ms  | 1099ms      | 822ms       |
| OpenRouter (direct)      | 1100ms | 1123ms      | 986ms       |
| Cloudflare → OpenRouter  | 1300ms | 1420ms      | 1279ms      |

These numbers are not directly comparable to ours — different location, different network, different day, n=5 vs n=75. What they are useful for is a sanity check: OpenRouter lands north of a second to first token in his run and in ours, from two different corners of the internet. Against his table, LLM Gateway's 906ms cold and 814ms warm sit at or below the best row — but the only comparison we will state as fact is the one we measured ourselves, interleaved, from one machine.

Location dependence cuts both ways, and the benchmark's README says so explicitly: results are a property of where you measure from, not a global ranking. Which is why the right move is to run it yourself.

## Run the benchmark yourself

The whole thing is a config file and two API keys:

```bash
git clone https://github.com/rbadillap/ai-gateways-benchmark
cd ai-gateways-benchmark
```

```json
{
  "runs_cold": 75,
  "runs_warm": 75,
  "prompt": "Reply with the single word: pong",
  "max_tokens": 16,
  "gateways": [
    {
      "name": "llmgateway",
      "host": "api.llmgateway.io",
      "path": "/v1/chat/completions",
      "model": "anthropic/claude-haiku-4-5",
      "auth_value": "Bearer $LLM_GATEWAY_API_KEY"
    },
    {
      "name": "openrouter",
      "host": "openrouter.ai",
      "path": "/api/v1/chat/completions",
      "model": "anthropic/claude-haiku-4.5",
      "auth_value": "Bearer $OPENROUTER_API_KEY"
    }
  ]
}
```

```bash
LLM_GATEWAY_API_KEY=... OPENROUTER_API_KEY=... python3 bench.py config.json
```

It prints per-run lines while it works, then a medians table, and dumps raw per-run JSON with request-id receipts. If you run it from your region and get different numbers — including ones where we lose — we want to see them.

## Latency is the tax you pay on every request

A gateway earns its hop with failover, unified billing, and one API across [every model it routes](https://llmgateway.io/models). But you pay its latency on every single request, forever. That makes time to first token one of the few gateway properties worth measuring before you commit — and one of the easiest, since the tooling is open source and takes minutes to run.

If you are on OpenRouter today, LLM Gateway speaks the same OpenAI-compatible API — switching means changing the base URL and swapping in an LLM Gateway API key, covered in the [OpenRouter migration guide](https://docs.llmgateway.io/migrations/openrouter).

## Frequently Asked Questions

### What is TTFT and why does it matter more than TTFB?

TTFT (time to first token) is the delay between sending a request and receiving the first piece of model output in the stream. TTFB (time to first byte) only measures when the server starts responding — a gateway can stream headers immediately while the model is still silent. For anything a user watches in real time, TTFT is the latency they actually experience.

### What is a good TTFT for an AI gateway?

It depends on the model and your distance from the gateway's edge, so compare gateways against each other rather than an absolute bar. In this AI gateway performance benchmark, first tokens from claude-haiku-4.5 arrived in roughly 800–900ms through LLM Gateway and 1200–1400ms through OpenRouter, measured from the same machine in the same session.

### Are these results valid from every location?

No — latency benchmarks are a property of the vantage point, and the benchmark's own README is explicit about it. Our numbers come from one residential connection on one day; the author's Vercel numbers come from another. The script is open source and takes minutes to run, so measure from where your servers actually live.

### Does LLM Gateway support the same models as OpenRouter?

LLM Gateway routes an overlapping catalogue — the full list is on the [models page](https://llmgateway.io/models), spanning the major closed and open-weight providers on the [providers page](https://llmgateway.io/providers). Requests use the OpenAI-compatible format either way, so moving a workload between the two is a base URL and key change.

---

**Measure it yourself:**

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — one key, streaming from day one
- **[Migrate from OpenRouter](https://docs.llmgateway.io/migrations/openrouter)** — a base URL and API key change
- **[What is an LLM gateway?](/blog/what-is-an-llm-gateway)** — where the hop pays for itself
