---
id: "blog-ai-gateway-benchmark"
slug: "ai-gateway-benchmark"
date: "2026-08-08"
title: "Ranked #1 on an Independent AI Gateway Benchmark"
summary: "In the August 7 run of computesdk's independent AI gateway benchmark, LLM Gateway ranked first of six gateways with a composite score of 90.8 — driven by the tightest tail latency in the field, not the fastest median. Here's what the benchmark measures, what our numbers actually show, and how to run it yourself."
categories: ["Engineering"]
faqs:
  - question: "What does an AI gateway benchmark actually measure?"
    answer: "A good one measures the latency the gateway itself adds, isolated from the model provider's own speed. computesdk's harness does this by running a direct-to-provider control alongside the gateways, pointing everything at the same model, and running all participants round-robin so they share the same network conditions. It separates cold requests (fresh connection, including DNS, TCP, and TLS) from warm ones (pooled connection), because those fail in different ways."
  - question: "Does an AI gateway add latency compared to calling the provider directly?"
    answer: "Yes. A gateway is an extra network hop, and no routing layer makes that free — in the August 7 run our warm TTFT median was 629 ms against the direct baseline's 615 ms. The question worth asking is what you get for it: failover across providers, unified billing and usage analytics, and a single API across model vendors. And the overhead is small enough that connection handling dominates it, which is why the tail, not the median, is where gateways actually differ."
  - question: "How do I run the AI gateway benchmark myself?"
    answer: "Clone [computesdk/benchmarks](https://github.com/computesdk/benchmarks), set an API key for each gateway you want to include, and run `pnpm bench:ai-gateway`. Gateways without keys are skipped, so you can benchmark just your own stack against the direct-to-provider control. Results are written to `results/ai-gateway/` as JSON, including every individual iteration, so you can compute your own percentiles rather than trusting anyone's composite."
image:
  src: "/blog/ai-gateway-benchmark.png"
  alt: "A circuit board with a glowing stopwatch on the central chip surrounded by a podium and rising bar chart, representing AI gateway latency benchmarks"
  width: 1536
  height: 1024
---

Every AI gateway sits between your application and the model provider, and every one of them adds a hop. So the question any platform team should ask before adopting one is blunt: how much does that hop cost, and how predictable is it?

Vendor-published numbers are close to worthless here, because the vendor picks the conditions. An independent AI gateway benchmark is worth more — and one exists. [computesdk](https://www.computesdk.com/benchmarks/ai-gateway/) runs an open-source harness that measures six gateways against a direct-to-provider control, on the same model, from the same machine, in the same round. In the August 7 run, **LLM Gateway** ranked first with a composite score of 90.8.

The more useful part isn't the ranking. It's which axis produced it.

## What the AI Gateway Benchmark Measures

Every participant is pointed at the same model — Claude Haiku 4.5 — from a 4 vCPU / 16 GB runner in Northern Virginia. Each gateway runs 20 cold iterations (fresh connection: DNS + TCP + TLS + time to first token) and 20 warm iterations (pooled connection, TTFT only), round-robin, so no gateway gets a quieter stretch of network than another. The August 7 run recorded zero failed requests across the entire field.

The composite score blends cold-start latency, warm latency, and throughput, weighting both medians and 95th percentiles.

| Rank | Gateway              | Composite |
| ---- | -------------------- | --------- |
| 1    | **LLM Gateway**      | **90.8**  |
| —    | _Anthropic (direct)_ | _89.8_    |
| 2    | Concentrate AI       | 89.5      |
| 3    | Pydantic             | 89.3      |
| 4    | Vercel               | 89.0      |
| 5    | OpenRouter           | 88.3      |
| 6    | Cloudflare           | 88.1      |

Anthropic (direct) is a no-gateway control, not a competing product. It's there to isolate how much latency each gateway adds on top of the underlying provider.

## Medians Hide the Problem. Tails Don't.

Look only at typical requests and every gateway looks the same. Fifty-four milliseconds covers our cold E2E median, the next-best gateway's, and the no-gateway baseline. That's noise for most workloads.

The percentiles are where the field separates:

| Metric          | LLM Gateway | Best of the rest | No-gateway baseline |
| --------------- | ----------- | ---------------- | ------------------- |
| Warm TTFT p95   | **1151 ms** | 1289 ms          | 2035 ms             |
| Cold E2E p95    | **1262 ms** | 1266 ms          | 1374 ms             |
| Cold E2E median | **594 ms**  | 601 ms           | 648 ms              |

A warm p95 of 1151 ms against a field that ranges to 4329 ms is the difference between a slow request your users notice and one they don't.

This matters more than it used to. A chatbot turn is one call, and a bad p95 costs one person one pause. An agent turn fans out into many sequential calls, and the tail compounds: at ten calls per turn, a p95 stall stops being an edge case and starts being most turns. Tail latency is the number that decides whether an agentic workload feels responsive.

<BlogCta variant="gateway" location="mid_article" />

## What We Changed in the Upstream Path

Our provider requests used to go out through bare global `fetch`. Undici's defaults close idle upstream sockets after four seconds and re-resolve DNS on every new connection, so any request arriving after a lull paid a full DNS + TCP + TLS handshake before its first token. Under Kubernetes' default `ndots:5`, one dropped UDP packet during the search-domain walk stalls a request for seconds — which is exactly the shape of a bad p95.

The gateway now installs a tuned dispatcher at boot ([#3225](https://github.com/theopenco/llmgateway/pull/3225)):

- **60-second idle keep-alive** on upstream connections, so warm sockets stay warm through normal traffic gaps
- **An in-process DNS cache**, so provider hostnames aren't re-resolved per connection
- **Redis auto-pipelining**, batching the dozens of pre-dispatch commands each request issues into single round trips
- **Cache-mirror bookkeeping moved off the critical path**, since no request result depends on it

None of that is exotic. It's the unglamorous work of making sure the connection to the provider is already open when your request shows up.

## Read the Caveats Before You Cite This

This is one run. Latency benchmarks are noisy, the field is tightly packed — under three composite points separate first from last — and week-to-week ordering moves. The repository's public history includes runs where we placed lower, and we'd rather you find that from us than discover it yourself and wonder what else we left out.

Two things this result does not say. It does not say a gateway is faster than talking to the provider directly; our warm TTFT median is 629 ms against the baseline's 615 ms, and a hop is still a hop. And it does not say any particular change caused the week-over-week movement — the dispatcher work above was already deployed for earlier runs.

What the August 7 numbers support is narrower and, we think, more useful: under identical conditions, our slow requests were the least slow in the field.

## Run It Yourself

The benchmark is open source and vendor-neutral. The harness, the scoring weights, and every historical run live in the repository:

```bash
git clone https://github.com/computesdk/benchmarks
cd benchmarks && git checkout 7548e7584940 && pnpm install

export LLMGATEWAY_API_KEY=...   # from your dashboard
export ANTHROPIC_API_KEY=...    # the no-gateway control

pnpm bench:ai-gateway --iterations 20
```

`7548e7584940` is the commit holding the August 7 results. `--iterations 20` matches that run's 20 cold and 20 warm probes per gateway; the default is 10. Any gateway whose API key isn't set is skipped, so the command above measures us against the direct-to-Anthropic control — add the other gateways' keys to reproduce the full leaderboard.

Results land in `results/ai-gateway/`, and the composite weighting is in `benchmarks/ai-gateway/scoring.ts`.

---

**[Try LLM Gateway free](https://llmgateway.io/signup)** — one API across every major provider, with automatic failover.

- **[See the live benchmark →](https://www.computesdk.com/benchmarks/ai-gateway/)** — current numbers, not this snapshot
- **[Routing and fallback docs →](https://docs.llmgateway.io/features/routing)** — how requests move across providers
- **[Portkey alternatives →](/blog/portkey-alternatives)** — how the AI gateway landscape compares

<BlogCta variant="gateway" location="bottom" />
