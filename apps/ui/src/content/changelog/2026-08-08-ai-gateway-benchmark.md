---
id: "76"
slug: "ai-gateway-benchmark"
date: "2026-08-08"
title: "Ranked #1 On The AI Gateway Benchmark"
summary: "In the August 7 run of computesdk's independent, open-source AI gateway benchmark, LLM Gateway ranked first of six gateways with a composite score of 90.8 — with the tightest tail latency in the field. The benchmark is fully reproducible: methodology, raw results, and harness are public."
image:
  src: "/changelog/ai-gateway-benchmark.png"
  alt: "A circuit board with a glowing stopwatch on the central chip and a rising leaderboard bar chart beside it, representing gateway latency benchmarks"
  width: 1536
  height: 1024
---

Every gateway sits between you and the model provider, and every gateway therefore adds a hop. The fair question a platform team asks is: how much does that hop cost, and how predictable is it? You shouldn't have to take a vendor's word for it. **In the August 7 run of [computesdk's independent AI gateway benchmark](https://www.computesdk.com/benchmarks/ai-gateway/), LLM Gateway ranked first of six gateways with a composite score of 90.8.**

## The Results

All participants were measured against the same model — Claude Haiku 4.5 — from a 4 vCPU / 16 GB runner in Northern Virginia, 20 cold and 20 warm iterations each, with zero failed requests across the field.

| Rank | Gateway              | Composite |
| ---- | -------------------- | --------- |
| 1    | **LLM Gateway**      | **90.8**  |
| —    | _Anthropic (direct)_ | _89.8_    |
| 2    | Concentrate AI       | 89.5      |
| 3    | Pydantic             | 89.3      |
| 4    | Vercel               | 89.0      |
| 5    | OpenRouter           | 88.3      |
| 6    | Cloudflare           | 88.1      |

Anthropic (direct) is a no-gateway control rather than a competing product — it exists to isolate how much latency each gateway adds on top of the underlying provider.

## Consistency, Not Just Speed

The composite blends cold-start latency, warm latency, and throughput, weighting both medians and 95th percentiles. Our result is driven by the percentiles — the slow requests, not the typical ones:

| Metric          | LLM Gateway | Best of the rest | No-gateway baseline |
| --------------- | ----------- | ---------------- | ------------------- |
| Warm TTFT p95   | **1151 ms** | 1289 ms          | 2035 ms             |
| Cold E2E p95    | **1262 ms** | 1266 ms          | 1374 ms             |
| Cold E2E median | **594 ms**  | 601 ms           | 648 ms              |

Median latency is where gateways look alike: 54 ms covers our cold E2E median, the next-best gateway's, and the no-gateway baseline. The tail is where they don't. A warm p95 of 1151 ms against a field that ranges to 4329 ms is the difference between a p95 your users notice and one they don't — and for anything agentic, where a single turn fans out into many sequential calls, the tail is what compounds.

**This is one run.** Latency benchmarks are noisy, the field is tightly packed, and week-to-week ordering moves. We publish the link rather than a screenshot precisely so you can check the current numbers instead of trusting a snapshot.

## What's Underneath

Provider requests used to go out through bare global `fetch`. Undici's defaults close idle upstream sockets after four seconds and re-resolve DNS on every new connection, so any request arriving after a lull paid a full DNS + TCP + TLS handshake before its first token — and under Kubernetes' default `ndots:5`, one dropped UDP packet during the search-domain walk stalls a request for seconds.

The gateway now installs a tuned dispatcher at boot ([#3225](https://github.com/theopenco/llmgateway/pull/3225)):

- 60-second idle keep-alive on upstream connections, so warm sockets stay warm
- an in-process DNS cache, so provider hostnames aren't re-resolved per connection
- Redis auto-pipelining, batching the dozens of pre-dispatch commands per request into single round trips
- cache-mirror bookkeeping moved off the critical path, since no request result depends on it

## Run It Yourself

The benchmark is open source and vendor-neutral. The harness, the scoring weights, and every historical run — including the ones where we placed lower — live in the repository:

```bash
git clone https://github.com/computesdk/benchmarks
cd benchmarks && git checkout 7548e7584940 && pnpm install

export LLMGATEWAY_API_KEY=...   # from your dashboard
export ANTHROPIC_API_KEY=...    # the no-gateway control

pnpm bench:ai-gateway --iterations 20
```

`7548e7584940` is the commit holding the August 7 results. `--iterations 20` matches that run's 20 cold and 20 warm probes per gateway — the default is 10. Any gateway whose API key isn't set is skipped, so the command above measures us against the direct-to-Anthropic control; add the other gateways' keys to reproduce the full leaderboard.

Results land in `results/ai-gateway/`, and the composite weighting is in `benchmarks/ai-gateway/scoring.ts`. Our participation was added in [computesdk/benchmarks#215](https://github.com/computesdk/benchmarks/pull/215).

---

**[Routing docs →](https://docs.llmgateway.io/features/routing)** | **[See the live benchmark →](https://www.computesdk.com/benchmarks/ai-gateway/)**
