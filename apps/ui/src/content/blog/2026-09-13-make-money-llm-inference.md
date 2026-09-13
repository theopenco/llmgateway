---
id: "blog-make-money-llm-inference"
slug: "make-money-llm-inference"
date: "2026-09-13"
title: "How to Make Money With LLM Inference Through Airside"
summary: "A practical guide to making money with LLM inference: list your deployment on LLM Gateway through Airside, file the prices developers pay, choose the landing fee you accept, and keep the rest of the traffic you win. Includes the fare math, a worked example, and the mistakes that cost providers revenue."
categories: ["Guides"]
faqs:
  - question: "Can I make money hosting open-weight LLMs?"
    answer: "Yes, if you can reach developers. Hosting an open-weight model is a commodity; distribution is the scarce part. Listing on LLM Gateway through Airside puts your deployment in the routing election for every request that names that model, and you are billed out at the price you filed."
  - question: "How do inference providers get paid through LLM Gateway?"
    answer: "Developers are billed at your filed price, less any discount you chose to offer. You keep that billed traffic less the landing fee you accept, which is 20% by default and adjustable between 5% and 50%. The console reports traffic; the settlement schedule is set in a written agreement with LLM Gateway."
  - question: "What does it cost to sell inference through Airside?"
    answer: "A one-time, non-refundable $2,500 listing fee per provider company, paid through Stripe before your claim is approved. Providers LLM Gateway already works with receive an invite code that waives it. There is no subscription, no minimum volume, and no charge on traffic you do not serve. Self-hosted deployments with no fee configured list for free."
  - question: "Is a lower price the only way to win routed traffic?"
    answer: "No. Price carries the heaviest routing weight, but uptime is nearly as heavy, and a deployment below 95% uptime is penalized exponentially. Verified capabilities, a cached-input price, throughput, and time to first token all change which provider wins a request."
image:
  src: "/blog/make-money-llm-inference.png"
  alt: "A glowing coin stack mounted on a central chip with light traces flowing toward it from a runway, surrounded by a paper plane, a price tag, and a bar chart on a circuit board"
  width: 1536
  height: 1024
---

Serving a model is the easy part of the inference business. A regional GPU cloud or a lab with a strong open-weight deployment can stand up an OpenAI-compatible endpoint in an afternoon. What it cannot do in an afternoon is find the developers who would pay for it. Selling inference one customer at a time means a sales pipeline, a billing stack, a status page, and months before the cluster pays for itself.

**Airside** is the other way to make money with LLM inference: list your deployment on **LLM Gateway**, file the price developers pay, and let the routing election send you traffic every time your deployment is the best answer for a request. This guide covers where the money comes from, how much of it you keep, and how to set your fares so you win.

## Where the money comes from

LLM Gateway is a routing layer in front of the model providers it lists. Developers send one request to `https://api.llmgateway.io/v1/chat/completions`, name a model, and the gateway picks the provider that serves it. In the seven days before this post was written, that layer routed about **249 billion tokens across 5.1 million requests**, and the [rankings page](https://llmgateway.io/rankings) shows which models carried them.

Every one of those requests ran an election among the providers listing that model. If your deployment is listed, it is a candidate. If it wins, the developer is billed at the price you filed and the tokens come out of your cluster. No sales call happened in between.

## How much of each request you keep

Airside describes the economics in three numbers you control from the console:

| Number               | Range               | What it does                                                                                              |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| **Filed price**      | Your choice         | Input, output, optional cached-input, and optional per-request rates. This is what developers are billed. |
| **Landing fee**      | 5–50%, baseline 20% | The gateway margin you accept on billed traffic. You keep the rest.                                       |
| **Traffic discount** | 0–50%               | A cut developers actually receive. Lower price, better routing score, shown on your model cards.          |

The routing election does not compare filed prices directly. It compares an **effective price** that folds in both knobs:

```text
effective price = filed price × (1 − discount) × (1 + 0.20 − landing fee)
```

At the baseline (no discount, 20% landing fee) the factor is exactly 1, so your filed price competes as filed. Accepting a 30% landing fee makes you compete as if you were 10% cheaper without changing what developers pay. Offering a 10% discount has the same routing effect, but developers see and receive the lower price.

Here is what each setting does to one dollar of filed-price traffic:

| Discount | Landing fee | Competes as | Developer pays | You keep |
| -------- | ----------- | ----------- | -------------- | -------- |
| 0%       | 20%         | $1.00       | $1.00          | $0.80    |
| 0%       | 30%         | $0.90       | $1.00          | $0.70    |
| 0%       | 50%         | $0.70       | $1.00          | $0.50    |
| 0%       | 5%          | $1.15       | $1.00          | $0.95    |
| 10%      | 20%         | $0.90       | $0.90          | $0.72    |
| 20%      | 20%         | $0.80       | $0.80          | $0.64    |
| 10%      | 30%         | $0.81       | $0.90          | $0.63    |

Two rows are worth comparing. A 10% discount and a 30% landing fee both make you compete at $0.90, and you keep almost the same amount either way ($0.72 against $0.70). The difference is who gets the other cents: with the discount, the developer does, and the saving is printed on your model card on llmgateway.io. With the landing fee, the gateway does. When you want to win traffic and build a reputation for being cheap at the same time, the discount is the better spend.

Settlement itself, meaning schedule, currency, and minimums, is governed by a written agreement with LLM Gateway rather than by the console. The Traffic page reports what you served; it is not an invoice.

## A worked example

Say you host an open-weight model and file $0.40 per million input tokens, $0.10 per million cached input tokens, and $1.60 per million output tokens. These are illustrative numbers, not a recommendation. In a month where routing sends you 2 billion input tokens, 20% of them served from your prompt cache, and 300 million output tokens:

| Line               | Tokens | Rate    | Billed     |
| ------------------ | ------ | ------- | ---------- |
| Uncached input     | 1.6B   | $0.40/M | $640       |
| Cached input       | 0.4B   | $0.10/M | $40        |
| Output             | 0.3B   | $1.60/M | $480       |
| **Total billed**   |        |         | **$1,160** |
| Landing fee at 20% |        |         | −$232      |
| **You keep**       |        |         | **$928**   |

Raise the landing fee to 30% and you keep $812 from the same traffic, but you enter every election at 90% of your filed price, which is usually worth more than the $116 you gave up. Whether it is depends on how close your competitors' prices are, which you can see on the [model pages](https://llmgateway.io/models) before you decide.

## What it costs to get listed

Listing on llmgateway.io carries a one-time, non-refundable **$2,500 listing fee** per provider company, paid through Stripe during onboarding and due before your claim is approved. Providers we already work with receive an invite code that waives it. There is no subscription and no minimum volume: after the fee, you only share the landing fee on traffic you actually win. One fee covers up to 10 crew members and as many carriers as your company operates. Self-hosted deployments with no fee configured list for free.

Against that fee, the calculation is simple. At the worked example's rates and a 20% landing fee, the listing pays for itself once you have served roughly 2.7 months of that traffic. A busier deployment or a higher-priced model gets there faster.

## Set up your listing in five steps

1. **Claim your carrier.** Sign up at [airside.llmgateway.io](https://airside.llmgateway.io) with a company email. If its domain matches your API endpoint's domain or your published website, your existing catalogue entry is claimable. Not listed yet? Register a new carrier by pointing Airside at your OpenAI-compatible base URL on the same domain. Free and disposable email domains are rejected.
2. **Register your fleet.** Add each model with its context window, maximum output, quantization, capability flags, and rate limits. Reuse the catalogue's canonical model ID so developers can compare your deployment against every other provider serving the same model.
3. **Pass preflight.** Airside probes your endpoint for every capability you declared: streaming, vision, tool calls, JSON output, reasoning, and more. A failed check tells you which flag to fix. The verified set becomes the capability badges developers see.
4. **File your fares.** Enter prices per million tokens. The initial filing activates the model once approved, and every later price change is an update filing that we review before it takes effect. Prices never move silently.
5. **Tune the knobs.** Set your landing fee and traffic discount per carrier or per model. Fare changes are filed for review like prices, and reach routing once approved.

The [Airside docs](https://docs.llmgateway.io/features/airside) cover each step, and the [listing guide](https://airside.llmgateway.io/guides/list-your-llm-api) walks through the console.

## Win the election on more than price

Price carries the heaviest weight in the routing election, but it is not the only factor. Every candidate is also scored on uptime and throughput, streaming requests add time to first token, and the lowest total wins. A few decisions move your share of traffic without touching your fares:

- **Stay above 95% uptime.** Below that threshold the gateway applies an exponential penalty: about 0.07 at 90%, 0.62 at 80%, and 1.73 at 70%. A cheap deployment that errors loses to a slightly pricier one that does not.
- **File a cached-input price.** For long prompts and coding sessions, routing blends your cached and uncached input prices by the cache-hit rate it has learned for that workload. A provider with no cached price competes at its full input price.
- **Declare only what you serve.** A request that needs tool calls only considers providers with tools enabled. Over-declaring wins you candidacy and then a failed request; under-declaring removes you from elections you would have won.
- **Set rate limits you can sustain.** Requests per minute and per day can be capped globally or per organization. A limit you hit is traffic you did not serve.
- **Report usage on streams.** The gateway asks for `stream_options.include_usage`. A stream that never reports completion tokens is billed at zero output.

The [carrier's guide to routing](/blog/llm-routing-carriers-guide) goes through the scoring in detail.

## Mistakes that cost providers revenue

- **A base URL that already ends in `/v1`.** The gateway appends `/v1/chat/completions` itself, so a doubled path fails every request. Registration now rejects it, but check your own docs.
- **Pricing that only works in tiers.** A listing holds one flat price pair per region. If your economics depend on context-length bands, file the rate you can sustain at the top band.
- **A discount nobody can see.** Discounts are filed, reviewed, and then shown on model cards and applied to bills. A pending filing does nothing until it is approved.
- **Forgetting regional fares.** If you run a cheaper deployment in one region, file it as a regional fare. Developers reach it with `provider/model:region`, and everyone else pays the default.

## Start selling inference

- **[Claim your carrier on Airside](https://airside.llmgateway.io)** and list your first model
- **[Read the Airside pricing summary](https://airside.llmgateway.io/pricing.md)** for the full economics in one page
- **[See how carriers win routed traffic](/blog/llm-routing-carriers-guide)** before you set your fares
