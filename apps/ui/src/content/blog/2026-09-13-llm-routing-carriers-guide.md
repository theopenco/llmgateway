---
id: "blog-llm-routing-carriers-guide"
slug: "llm-routing-carriers-guide"
date: "2026-09-13"
title: "How LLM Routing Picks a Provider: A Carrier's Guide"
summary: "LLM routing on LLM Gateway is an election: every provider listing a model is scored on effective price, uptime, throughput, and latency, and the lowest score wins. This guide explains the scoring from the provider's side, with the fare formula, the uptime penalty, cache-aware pricing, and the levers a carrier controls from Airside."
categories: ["Guides", "Engineering"]
faqs:
  - question: "How does LLM Gateway decide which provider serves a request?"
    answer: "Every provider listing the requested model that supports the request's features is scored on price after discount and landing fee (weight 0.6), uptime (0.5), throughput (0.05), and time to first token (0.025, streaming only). Each factor is a ratio against the best candidate, weights are normalized, and the lowest total score wins. There is no paid placement."
  - question: "Does accepting a higher landing fee guarantee more traffic?"
    answer: "No. It lowers your effective price in the election by the same percentage points above the 20% baseline, so a 30% landing fee competes like a 10% price cut. Whether that wins depends on how close the other candidates are and on your uptime, which carries almost as much weight as price."
  - question: "How does a new provider get traffic before it has metrics?"
    answer: "The gateway sends about 1% of requests to randomly chosen candidates so new listings build uptime, throughput, and latency history. Once those metrics exist, the provider competes in the full election."
  - question: "Why does prompt caching matter for routing?"
    answer: "For prompts of 5,000 tokens or more, and when a session picks its provider, routing prices each candidate with the cache-hit rate and output ratio it has learned for that workload. A provider with a filed cached-input price competes on the blended rate; one without competes at its full input price."
image:
  src: "/blog/llm-routing-carriers-guide.png"
  alt: "A glowing dispatch radar on a central chip with light traces splitting toward three provider gates on a circuit board, surrounded by a stopwatch, a price tag, and an uptime gauge"
  width: 1536
  height: 1024
---

When a developer sends `{"model": "some-model"}` to LLM Gateway, they are not choosing a provider. Routing does that, per request, among every provider that lists the model. If you are one of those providers, the election decides how much of the gateway's traffic lands on your cluster, so it pays to know exactly how it counts.

This is the carrier's view of **LLM routing** on **LLM Gateway**: what gets scored, what you control from [Airside](https://airside.llmgateway.io), and what you can only earn by running a good deployment.

## Who is on the ballot

Before any scoring, the gateway drops candidates that cannot serve the request. A request with tools only considers listings with tools enabled; the same applies to vision, audio input, JSON output, JSON schema output, reasoning, reasoning budgets, and web search. Your capability flags come from what you declared on Airside and what passed preflight verification, so a flag you did not earn keeps you out of those elections.

Developers can also skip the election. A request for `provider/model` pins your deployment, and `x-no-fallback: true` keeps it there even if you fail. Pinned traffic is why your provider page on llmgateway.io, your logo, and your verified badges matter: they are what a developer reads before deciding to pin you.

## How the score is built

Each remaining candidate is scored on four factors by default. The factor is a ratio against the best candidate in the set, so the cheapest provider scores 0 on price and one twice as expensive scores 1.0. Each ratio is multiplied by its weight divided by the sum of the active weights, and the lowest total wins.

| Factor     | Weight  | Measured as                                             |
| ---------- | ------- | ------------------------------------------------------- |
| Price      | `0.6`   | Expected token cost after your discount and landing fee |
| Uptime     | `0.5`   | Success rate over a rolling window                      |
| Throughput | `0.05`  | Output tokens per second                                |
| Latency    | `0.025` | Time to first token, streaming requests only            |
| Cache      | `0`     | Optional cache-support preference, off by default       |

Cache-read savings already count toward price, so the separate cache factor defaults to zero; Enterprise projects can enable it under `auto`, and only then does cache support score on its own for cache-relevant requests. Price and uptime share over 90% of the weight between them. Throughput and latency break ties between providers that are otherwise close. For non-streaming requests the latency weight is dropped and its share is spread across the others. Developers can also send `routing: "price"`, `"throughput"`, or `"latency"` to give one factor 90% of the weight, which is how a fast deployment wins requests it would lose on price.

## The fare formula

Your filed price is what developers are billed. The election uses an **effective price** that folds in the two knobs on Airside's Fares page:

```text
effective price = filed price × (1 − discount) × (1 + 0.20 − landing fee)
```

The landing fee is the gateway margin you accept, from 5% to 50% with a 20% baseline. At the baseline with no discount the factor is 1. Every percentage point of landing fee above 20% is a point off your effective price; every point below adds one. A traffic discount lowers both the effective price and what developers pay, and it appears on your model cards once approved.

Take two carriers serving the same model. Carrier A files $0.50 per million tokens, Carrier B files $0.40, both at the baseline landing fee. B is cheapest and scores 0 on price; A is 25% more expensive and scores 0.25. If A accepts a 30% landing fee, A competes at $0.45 and its price score drops to 0.125. If A also offers a 10% discount, it competes at $0.405 and the price gap nearly closes, with A still keeping 63 cents of every filed dollar. Whether A then wins comes down to uptime.

Fare changes are filed for review like price changes and only reach routing once approved, so plan them rather than toggling them.

## The uptime penalty

Uptime is measured over a rolling 60-minute window with time decay: the last minute counts 10×, the last five minutes 3×, and the rest 1×. A bad five minutes shows up in routing immediately and fades out within the hour.

Above 95% uptime there is no extra penalty beyond the weighted factor. Below it, an exponential penalty is added to the score:

| Uptime | Added penalty |
| ------ | ------------- |
| 95%    | 0             |
| 90%    | ~0.07         |
| 80%    | ~0.62         |
| 70%    | ~1.73         |
| 50%    | ~5.61         |

For scale, a price score of 1.0 means "twice the cheapest candidate". A deployment at 80% uptime carries a penalty larger than that, so no fare setting rescues it.

Rate limits work differently. A listing at its `maxRpm` or `maxRpd` cap is skipped by routing until the window resets, so the request goes elsewhere without touching your uptime. A cap below your real capacity is simply traffic you did not serve. Pick per-organization scope only if a single tenant hitting the cap should not affect the rest.

## Cache-aware pricing

Small requests outside a session weight input and output prices equally. For prompts the gateway estimates at **5,000 tokens or more**, and whenever a session chooses its provider, the price factor becomes:

```text
price = (cachedInputPrice × h + inputPrice × (1 − h) + outputPrice × r) / 2
```

Here `h` is the cache-hit rate and `r` the output-to-input ratio that routing has learned from the project's last 24 hours of usage for that model, starting from workload defaults (90% and 2% for coding clients, 10% and 20% for general API traffic). A provider without a filed cached-input price is scored at its full input price.

This is the lever most carriers miss. With coding defaults, a listing at $0.40 input and $1.60 output with no cached price is scored at about $0.216 per million. The same listing with a $0.10 cached-input price is scored at about $0.081. Filing a cached rate you can honor makes you almost three times cheaper in the elections that matter most for agent and coding traffic, which is the bulk of long-prompt volume on the gateway.

## Sessions, stability, and exploration

Three more rules shape how traffic actually arrives:

- **Sticky sessions.** When a developer attaches a session ID, the first request runs the election and the winner is pinned for the whole conversation while it stays healthy. Winning the opening request wins the session, and losing availability mid-session hands it to the next-best provider.
- **Stable preference.** The gateway remembers the best provider for a model and stays with it unless another candidate edges clearly ahead, so a marginal score improvement does not flip traffic back and forth.
- **Exploration.** About 1% of requests go to a randomly chosen candidate. This is how a new listing with no history builds the uptime, throughput, and latency metrics it needs to compete.

Together these mean a new carrier should expect a trickle first, then a step change once its metrics exist and it starts winning session openers.

## What you control, and what you earn

| From Airside                             | From your deployment               |
| ---------------------------------------- | ---------------------------------- |
| Filed price, cached-input price          | Uptime and error rate              |
| Landing fee and traffic discount         | Throughput                         |
| Capability flags (verified by preflight) | Time to first token                |
| Rate limits and their scope              | Prompt-cache hit rate              |
| Regional fares                           | Correct usage reporting on streams |

The left column can be changed in a filing. The right column is measured live, and it is where most elections are decided once fares are close.

## Next steps

- **[Claim your carrier on Airside](https://airside.llmgateway.io)** and file your fares
- **[Read the routing docs](https://docs.llmgateway.io/features/routing)** for the full scoring algorithm and session behavior
- **[See how the economics work](/blog/make-money-llm-inference)** before you pick a landing fee
