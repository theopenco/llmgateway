---
id: "devpass-vs-opencode-zen"
slug: "opencode-zen"
date: "2026-10-10"
title: "DevPass vs OpenCode Zen"
metaTitle: "DevPass vs OpenCode Zen: Pricing, Fees and Token Rates (2026)"
description: "Compare OpenCode Zen’s at-cost pay-as-you-go pricing and card fees with DevPass’s 2× monthly allowance, including per-token rates for the same models."
competitor: "OpenCode Zen"
competitorLogo: "opencode-zen"
competitorTagline: "Pay-as-you-go model access at cost"
tagline: "Zen sells tokens at cost with card fees passed through. DevPass includes 2× its price in usage every month, with open models at LLM Gateway’s multi-provider rates."
devpassPrice: "$29–$179/mo"
competitorPrice: "Usage + card fees"
verdict: "Choose Zen for light or irregular usage, or to try free limited-time models: there’s no subscription and you pay 1× plus card fees. Choose DevPass if you code most days: every plan includes 2× its price in usage, and open models like GLM, DeepSeek and MiniMax cost 30–75% less per token than on Zen. Frontier models like Claude Opus and Sonnet are priced the same on both."
features:
  - label: "Pricing model"
    devpass: "Monthly subscription + optional overflow"
    competitor: "Pay as you go"
  - label: "Usage per dollar paid"
    devpass: "2× ($58 / $158 / $358 on $29 / $79 / $179)"
    competitor: "1× (at cost)"
  - label: "Payment fees"
    devpass: "None on top of the plan"
    competitor: "4.4% + $0.30 per card transaction (about 6% on a $20 top-up)"
  - label: "GLM-5.3 rate (per 1M in / out)"
    devpass: "From $0.90 / $3.00"
    competitor: "$1.40 / $4.40"
  - label: "DeepSeek V4.1 Flash rate (per 1M in / out)"
    devpass: "From $0.135 / $0.54"
    competitor: "$0.30 / $1.20"
  - label: "Claude Opus 5.5 rate (per 1M in / out)"
    devpass: "$4.00 / $20.00"
    competitor: "$4.00 / $20.00"
  - label: "Free models"
    devpass: false
    competitor: true
  - label: "Usage controls"
    devpass: "Daily and premium weekly caps; optional overflow"
    competitor: "Workspace and member monthly spend limits"
  - label: "Team use"
    devpass: "One developer per subscription"
    competitor: "Workspace and member controls"
faqs:
  - question: "Does Zen mark up model tokens?"
    answer: "No. OpenCode sells Zen tokens at cost and passes card processing through at 4.4% plus $0.30 per transaction. On the default $20 top-up that is $1.23, about 6%."
  - question: "Why are some models cheaper on DevPass than on Zen?"
    answer: "Zen keeps each model on providers OpenCode has benchmarked and doesn’t route to cheaper ones. LLM Gateway lists several providers for popular open models and routes on price, uptime and speed, so GLM-5.3, DeepSeek V4.1 Flash and MiniMax M2.7 usually run 30–75% below Zen’s rates. Claude, Kimi and Qwen rates are the same on both."
  - question: "When is Zen cheaper than DevPass?"
    answer: "When you’d spend less than the plan price in a month. DevPass Lite costs $29 for $58 of usage, so if your monthly usage at Zen rates stays under about $27 after card fees, Zen costs less. Above that, DevPass includes more usage per dollar."
  - question: "Does Zen guarantee zero retention for every model?"
    answer: "No. Zen documents exceptions, including provider retention windows and different treatment of some free models. Check the current policy for the route you use."
---

## Token pricing and payment fees

OpenCode Zen is pay as you go, with no subscription. OpenCode sells tokens at cost and passes card fees through at **4.4% + $0.30 per transaction** ([Zen pricing](https://opencode.ai/docs/zen/#pricing)), so the default $20 top-up costs $21.23. You get 1× usage per dollar, minus about 6% in fees.

DevPass includes **2× its price** in usage each month from October 15, 2026, with no fee on top. Per-token rates differ only where LLM Gateway can route to a cheaper provider:

| Per 1M tokens, input / output | DevPass (lowest listed) | OpenCode Zen   |
| ----------------------------- | ----------------------- | -------------- |
| GLM-5.3-Flash                 | $0.088 / $0.25          | $0.15 / $0.50  |
| GLM-5.3                       | $0.90 / $3.00           | $1.40 / $4.40  |
| DeepSeek V4.1 Flash           | $0.135 / $0.54          | $0.30 / $1.20  |
| DeepSeek V4 Pro               | $0.435 / $0.87          | $1.74 / $3.48  |
| MiniMax M2.7                  | $0.08 / $0.32           | $0.30 / $1.20  |
| Gemini 3.8 Flash              | $0.75 / $3.75           | $1.50 / $7.50  |
| Kimi K3                       | $3.00 / $15.00          | $3.00 / $15.00 |
| Claude Opus 5.5               | $4.00 / $20.00          | $4.00 / $20.00 |
| Claude Sonnet 5.5             | $2.00 / $10.00          | $2.00 / $10.00 |

Zen keeps each model on providers it has benchmarked rather than routing to the cheapest. LLM Gateway routes on price, uptime and speed, so a request can land above the lowest listed rate; check the live [coding catalog](/coding-models).

## When each one costs less

- **Zen** costs less if your month stays under roughly $27 of usage at Zen rates. It also has about a dozen free models for a limited time.
- **DevPass Lite** ($29 for $58) costs less above that, and the gap widens on open models where DevPass rates are lower. At GLM-5.3 rates, Lite’s allowance buys about as many tokens as $85 spent on Zen.

## Controls and privacy

Zen provides monthly workspace and member spending limits, auto-reload (by default $20 when your balance drops below $5) and BYOK support. Auto-reload can charge you past a spend limit, so configure both. Its retention policy has model-specific exceptions, including some upstream providers and free models; read the current [Zen documentation](https://opencode.ai/docs/zen/).

## DevPass pricing and limits

DevPass costs **$29/month for Lite, $79 for Pro, or $179 for Max**, for one developer. From **October 15, 2026**, new subscriptions include 2× the plan price in monthly usage ($58, $158, $358); existing subscriptions move to 2× at their first renewal on or after that date. Daily caps (8%, 9%, 10% of the monthly allowance), premium weekly caps (10%, 12%, 15%) and Reset Pass prices ($5, $15, $45) take effect October 15, including within existing billing cycles. Optional pay-as-you-go overflow costs extra. Read the [plan-change terms](/legal/terms#october-2026-plan-changes) before subscribing.

For the three-way breakdown with OpenCode Go, read [DevPass vs OpenCode Go vs OpenCode Zen](https://llmgateway.io/blog/devpass-vs-opencode-go-vs-zen).
