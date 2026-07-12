---
id: blog-microsoft-copilot-enterprise-pricing
slug: microsoft-copilot-enterprise-pricing
date: 2026-07-12
title: "Microsoft Copilot Enterprise Pricing in 2026, Explained"
summary: "Microsoft repriced enterprise Copilot three times in June 2026: GitHub Copilot moved to usage-based AI Credits, Copilot Cowork added per-task billing on top of the $30 seat, and volume discounts expired. What it costs now — and the cost-control playbook enterprises are adopting instead."
categories: ["Guides"]
image:
  src: "/blog/microsoft-copilot-enterprise-pricing.png"
  alt: "Microsoft Copilot enterprise pricing in 2026 — seat-based costs turning into metered usage flowing through a controlled gateway"
  width: 1536
  height: 1024
---

In a single month, Microsoft changed enterprise Copilot pricing three times. On June 1, 2026, GitHub Copilot moved chat and agent features to usage-based AI Credits. On June 16, Copilot Cowork launched globally with per-task pricing billed on top of the $30 Microsoft 365 Copilot seat. And on June 30, the volume discounts many enterprise agreements relied on expired.

None of these changes raised a sticker price. All of them raised the bill. This post lays out exactly what Microsoft Copilot enterprise pricing looks like in 2026, why the numbers move the way they do, and what cost-control levers enterprises actually have.

## What Changed in June 2026

| Date          | Change                                                                               | Impact                                                                                  |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| June 1, 2026  | GitHub Copilot switches chat, agent mode, code review, and CLI to metered AI Credits | Usage above included credits bills at $0.01/credit with no default ceiling              |
| June 16, 2026 | Copilot Cowork launches with per-task pricing                                        | $1–3 (light), $4–7 (medium), $7+ (heavy) per task, on top of the $30/user/month license |
| June 30, 2026 | Volume discounts on the $30 Microsoft 365 Copilot add-on expire                      | New agreements and renewals price the add-on at list; existing terms hold until renewal |

Underneath, Microsoft 365 base licenses also rose effective July 1, 2026: E3 moved from $36 to $39 per user per month, E5 from $57 to $60, and Business Standard from $12.50 to $14, with existing customers keeping current pricing until their next renewal — so the floor under every Copilot seat went up too.

## GitHub Copilot: AI Credits Replace the Flat Fee

Seat prices didn't move — Business is still $19 per user per month and Enterprise $39. What moved is what the seat covers. Inline completions stay flat-fee, but everything else — Copilot Chat, agent mode, code review, CLI — now consumes AI Credits (1 credit = $0.01), with per-request cost varying by model. Code review can additionally consume GitHub Actions minutes when reviews run for unlicensed users.

The practical numbers:

- A typical premium-model chat session (roughly 4,000 input and 800 output tokens) costs about $0.21 — around $84 per month at 20 sessions a day.
- Heavy chat users report $150–$250 per month in overages on top of their seat.
- One three-developer team running agent mode projected a jump from $50 to $3,000 per month.

There is no ceiling unless you configure one. Plans include monthly credit allowances, and spending budgets exist in the billing dashboard — but the budgets are off by default, an inversion of how the product was sold to procurement, where the seat price was the cap.

For the developer-tool side of this, see the [best GitHub Copilot alternatives](/blog/github-copilot-alternatives) and the [LLM Gateway vs GitHub Copilot comparison](/compare/github-copilot).

## Microsoft 365 Copilot: Higher Floors, Metered Ceilings

The $30 per user per month Copilot add-on is unchanged on paper. In practice, three things raised its real cost:

1. **The base license under it went up.** Copilot requires a qualifying Microsoft 365 plan, and E3/E5/Business Standard all rose $2–3 per user per month in 2026.
2. **Volume discounts expired June 30, 2026.** Agreements that priced Copilot below list return to $30 at their next renewal.
3. **Copilot Cowork bills per task, on top of the seat.** Cowork — the agentic mode that runs multi-step tasks across enterprise data — launched globally on June 16, 2026 with usage-based pricing. [Microsoft's published estimates](https://learn.microsoft.com/en-us/microsoft-365/copilot/usage-based-billing-overview-copilot-credits) put light tasks around $1–3, medium $4–7, and heavy $7 and up. Task cost depends on the model used, the context retrieved, tool calls made, and runtime. Usage is billed in Copilot Credits at $0.01 each, pay-as-you-go or through a volume commitment.

Microsoft's own framing is telling: executives have said heavy users run hundreds of tasks a week — great for productivity, but "the costs can go very high." That is the vendor describing its own pricing model.

## The Pattern: Seats Are Becoming Meters

Both changes are the same change. Agentic AI made flat seats unprofitable — [one industry analysis](https://www.beri.net/article/microsoft-copilot-cowork-usage-based-pricing-enterprise-ai-budget-2026) puts the cost of a typical enterprise AI interaction at $1.20 in 2026, up from $0.04 in 2023, a 30x increase driven by multi-step agent workflows. Vendors responded by metering the expensive part.

Metered pricing isn't inherently bad — it's how every serious AI platform prices, including ours. The problem is metered pricing **without controls**: no default ceiling, per-model math you can't see at request time, and usage attributed to a seat rather than a team or project. Enterprises aren't leaving Copilot because usage-based billing exists; they're leaving because they can't govern it.

## The Enterprise Cost-Control Playbook

Whatever stack replaces or supplements Copilot, these are the controls to demand:

1. **Per-request visibility.** Every request should record model, tokens, cost, latency, and which team spent it. Monthly roll-ups are how $3,000 surprises happen.
2. **Hard caps, not alerts.** Budgets per organization, project, and API key that stop requests at the limit. An alert after the money is spent is a receipt, not a control.
3. **Pass-through token pricing.** Pay what providers charge, with the platform fee visible and flat — not baked into a per-credit rate you can't audit.
4. **Prompt caching.** Agentic workloads resend the same context — system prompts, file trees, retrieved documents — on nearly every request. Caching routinely absorbs a large share of that spend automatically.
5. **Model right-sizing.** Routing light tasks to light models is the single biggest lever: the same chat workload that costs $84 a month on a premium model costs about $6.40 on a mini model. Route by task, not by default.
6. **No seat lock-in.** An OpenAI-compatible API means the tools on top — coding agents, chat UIs, internal apps — can change without renegotiating a contract.

## Where LLM Gateway Fits

**LLM Gateway** is an open-source AI gateway built around exactly these controls: one API in front of 200+ models from 40+ providers, zero markup on provider token rates (a flat 5% fee on credits, or 0% with your own provider keys), automatic prompt caching, and budgets with hard limits per organization, project, and key.

For enterprises specifically:

- **Self-host under AGPLv3** or run in our managed cloud — data-residency requirements stop being a blocker
- **Guardrails on the Enterprise plan** — PII, prompt-injection, and secret detection at the gateway, before requests leave your boundary
- **SSO, roles, and audit logs** built in, not paywalled per feature
- **[DevPass](https://devpass.llmgateway.io)** flat plans (from $29/month) for developer seats that need a predictable number
- A **30-Day Production Pilot** for enterprise teams that want to validate real workloads before committing — see the [enterprise page](/enterprise)

Migrating developer workloads takes an afternoon, not a quarter — the [GitHub Copilot migration guide](/migration/github-copilot) walks through it feature by feature.

## Frequently Asked Questions

### How much does Microsoft 365 Copilot cost in 2026?

$30 per user per month, on top of a qualifying Microsoft 365 license (E3 is now $39, E5 $60, Business Standard $14). Volume discounts on the add-on expired June 30, 2026, and agentic Copilot Cowork tasks bill separately at roughly $1–3 for light tasks, $4–7 for medium, and $7+ for heavy.

### What is Copilot Cowork and how is it priced?

Cowork is Microsoft's agentic mode that executes multi-step tasks across enterprise data. It launched globally June 16, 2026. Pricing is per task — driven by the model used, context retrieved, tool calls, and runtime — billed in Copilot Credits on top of the $30 Copilot license, via pay-as-you-go or a volume commitment.

### How much does GitHub Copilot Enterprise cost after the June 2026 change?

The seat is still $39 per user per month, but chat, agent mode, code review, and CLI usage now meter as AI Credits at $0.01 each with no default cap. Real-world overages range from a few dollars for light users to hundreds per developer for agent-heavy workflows.

### How can enterprises cap Copilot-style AI spend?

Put a gateway between your tools and the model providers. LLM Gateway enforces hard budget limits per organization, project, and API key, records cost per request, caches repeated context automatically, and passes provider prices through with no markup — so spend is visible, attributable, and bounded.

---

## Get Ahead of the Next Repricing

If June 2026 is the month AI spend became a line item your CFO reads:

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — no credit card required, one API for 200+ models
- **[Estimate your Copilot costs](/copilot-cost-calculator)** — model your team's usage under AI Credits vs pass-through pricing
- **[Talk to us about an enterprise pilot](/enterprise)** — 30 days on production workloads, with your own keys if you prefer
