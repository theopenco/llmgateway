---
id: "blog-opencode-go-pricing"
slug: "opencode-go-pricing"
date: "2026-08-24"
title: "OpenCode Go's New Pricing, Explained"
summary: "OpenCode Go replaced its request-count tiers with dollar metering: $10/month now buys up to $60 of usage at published per-token rates, with Grok 4.5 and GPT-5.6 Luna capped at $15 each. Here's exactly what changed, the math per dollar, and when the ceiling stops fitting."
categories: ["Guides"]
faqs:
  - question: "How much does OpenCode Go cost in 2026?"
    answer: "$10 per month, single plan. Since the August 2026 pricing update there are no higher tiers and no annual option. Usage is metered in dollars at each model's published per-token rate, capped at $12 per rolling 5-hour window, $30 per week, and $60 per month."
  - question: "What are OpenCode Go's usage limits?"
    answer: "Three stacked dollar caps — $12 per 5 hours, $30 per week, $60 per month — plus per-model monthly allocations: premium models like Grok 4.5, GPT-5.6 Luna, Kimi K3 and Qwen3.8 Max are each limited to $15 of usage per month, DeepSeek V4 Flash to $30, and the standard open-weight coders to the full $60."
  - question: "Does OpenCode Go include Claude or GPT models?"
    answer: "Partly. The update added Go's first closed models — Grok 4.5 and GPT-5.6 Luna, OpenAI's cost-optimized 5.6 variant — each capped at $15/month of usage. There is still no Claude, no Gemini, and no frontier-tier GPT-5.6 Sol. For those you need a separate plan; DevPass includes all of them on every tier."
  - question: "What happens when I hit OpenCode Go's usage limit?"
    answer: "Requests fall back to the free models (currently Ox Alpha Free, marked limited-time), or — if you enable the Use balance option — Go draws on your Zen pay-as-you-go balance instead of blocking. Either way, the $10 plan itself never buys more than $60 of usage in a month."
image:
  src: "/blog/opencode-go-pricing.png"
  alt: "A circuit board with a glowing price meter on the central chip surrounded by model icons, representing OpenCode Go's new dollar-metered pricing"
  width: 1536
  height: 1024
---

OpenCode Go changed how its $10/month plan works. The old system counted requests per model in a rolling 5-hour window, with higher tiers to raise the ceiling. The new system, live on [opencode.ai/go](https://opencode.ai/go), meters usage in **dollars at each model's published per-token rate** — and there's now exactly one plan.

If you're picking a coding plan, this update makes Go much easier to reason about, and it quietly changes who it's for. Here's the OpenCode Go pricing model in full, what a dollar actually buys, and where the ceiling sits.

## What Changed

Three things:

1. **Request counts became dollar metering.** Every request is billed against your allowance at the model's listed input/output rates — the same per-million-token math an API bill uses, just prepaid.
2. **Tiers became one plan.** $10/month, no higher tiers, no annual option, one subscriber per workspace.
3. **The catalog crossed the open-weight line.** Alongside the open coders — GLM-5.2, Kimi K3, Qwen3.8 Max, DeepSeek V4, MiniMax M3, MiMo V2.5 — Go now carries its first closed models: **Grok 4.5** and **GPT-5.6 Luna**.

## The Limits, Exactly

The $10 plan stacks three time-window caps:

| Window          | Usage included |
| --------------- | -------------- |
| Rolling 5 hours | $12            |
| Week            | $30            |
| Month           | $60            |

On top of that, each model carries its own monthly allocation:

| Allocation | Models                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------- |
| $15/mo     | Grok 4.5, GPT-5.6 Luna, GLM-5.3, Kimi K3, Qwen3.8 Max, DeepSeek V4 Pro, MiMo V2.5 Pro             |
| $30/mo     | DeepSeek V4 Flash                                                                                 |
| $60/mo     | GLM-5.2, GLM-5.1, Kimi K2.7 Code, Kimi K2.6, Qwen3.7 Max, MiniMax M3, MiMo V2.5, LongCat-2.0, Hy3 |

Because metering runs at per-token rates, how far $60 goes depends entirely on which model you pick. At Grok 4.5's rates ($2/M input, $6/M output) the $15 allocation is a handful of serious agent sessions. At MiMo V2.5's rates ($0.14/M in, $0.28/M out) the monthly ceiling is, for most people, effectively unreachable.

Past a limit, requests drop to the free models — currently Ox Alpha Free, explicitly marked limited-time — or, if you enable the **Use balance** option, Go draws on your Zen pay-as-you-go balance instead of blocking.

## The Math per Dollar

Here's the part worth being honest about: **$10 for up to $60 of usage is a 6× ratio, and that's the best ratio of any flat coding plan we know of** — including ours. [DevPass](https://devpass.llmgateway.io) turns every $1 into roughly $3 of usage at provider rates.

The difference is what the ratio is attached to. Go's 6× ends at $60, hard. There is no bigger plan to move to, and the per-model allocations mean the models you'd most want for hard problems — Grok 4.5, GPT-5.6 Luna, Kimi K3 — stop at $15 each. DevPass's 3× is attached to allowances of ~$87 (Lite, $29), ~$237 (Pro, $79) and ~$537 (Max, $179), with [Claude Opus 5, GPT-5.6 and Gemini 3.1 Pro](https://llmgateway.io/models) in the catalog and opt-in pay-as-you-go overflow past the cap.

So the decision reduces to two questions:

- **Does your month fit inside $60 of usage?** Count agent sessions honestly — a single long Claude Code-style run can burn several dollars on a mid-priced model.
- **Do you ever need Claude, Gemini, or frontier-tier GPT?** Go has none of them. GPT-5.6 Luna is OpenAI's cost-optimized variant, not the frontier Sol tier.

Two yeses to the first and noes to the second: take Go, it's the cheapest seat in the market. Otherwise the ceiling — not the price — is what you're actually choosing.

<BlogCta variant="devpass" location="mid_article" />

## Where Go Fits Now

The update repositions Go from "cheap requests for open models" to something closer to a **starter meter**: transparent dollar pricing, a taste of the closed frontier, and a hard monthly stop that keeps it at $10. That's a genuinely good product for evenings-and-weekends coding on open-weight models.

The full head-to-head — catalog, caps, overflow, dashboards — is in our updated [DevPass vs OpenCode Go comparison](https://devpass.llmgateway.io/compare/opencode-go). For the wider field, see the [best AI coding plans in 2026](/blog/best-ai-coding-plans), where Go now appears in the ranking.

---

- **[Try DevPass](https://devpass.llmgateway.io/pricing)** — flat plans from $29/mo with ~3× usage across 200+ models, Claude and Gemini included
- **[Compare DevPass vs OpenCode Go](https://devpass.llmgateway.io/compare/opencode-go)** — the detailed head-to-head
- **[Read the full coding-plan ranking](/blog/best-ai-coding-plans)** — eleven plans, compared honestly

<BlogCta variant="devpass" location="bottom" />
