---
id: "blog-ai-gateway-fees-compared"
slug: "ai-gateway-fees-compared"
date: "2026-06-23"
title: "AI Gateway Fees Compared: Who Marks Up Your Tokens?"
summary: "AI gateway pricing hides in two places — the platform fee on credits and the markup on tokens. Here's what OpenRouter, Vercel, Cloudflare, Portkey, LiteLLM, and LLM Gateway actually charge, and how to pay the least."
categories: ["Guides"]
image:
  src: "/blog/ai-gateway-fees-compared.png"
  alt: "Token streams flowing through a gateway, each tagged with a percentage fee"
  width: 1536
  height: 1024
---

Comparing AI gateways on price sounds simple until you read the fine print. The number on the pricing page is rarely the number on your invoice, because gateway fees hide in two separate places: a **platform fee** on the credits you buy, and a **markup** on the tokens you spend. Miss either one and your "cheap" gateway quietly costs more than the provider you were trying to save money on.

This guide breaks down what the major AI gateways actually charge in 2026, using each vendor's published pricing. **LLM Gateway** is one of them, so we're biased — but the table below is the real picture, including where others are cheaper for a given workload.

## Two fees, not one

Every gateway makes money in one (or both) of two ways:

- **Token markup** — a percentage added on top of the provider's per-token rate. A 10% markup on a $5/1M-token model means you pay $5.50. This is the expensive one, because it scales with every token forever.
- **Platform / credit fee** — a flat percentage taken when you load credits (often with a minimum), or a monthly/usage subscription. This is usually the smaller one.

The healthiest pricing model is **zero token markup** plus a transparent, predictable platform fee — and the option to drop even that by bringing your own provider keys.

## What each gateway charges

| Gateway               | Token markup | Platform / subscription fee                    | Bring your own keys        | Self-host     |
| --------------------- | ------------ | ---------------------------------------------- | -------------------------- | ------------- |
| **LLM Gateway**       | None         | 5% on credits (0% with your own keys)          | Free                       | Free (AGPLv3) |
| OpenRouter            | None         | 5.5% on card credits ($0.80 min; 5% crypto)    | Free to 1M req/mo, then 5% | No            |
| Vercel AI Gateway     | None         | Pay-as-you-go credits + payment fees           | Free (paid tier)           | No            |
| Cloudflare AI Gateway | None         | Free direct; +5% if you use Unified Billing    | Yes                        | No            |
| Eden AI               | None         | 5.5% on credits                                | Yes                        | No            |
| Portkey               | None         | Free tier; Production $49/mo (+$9/100k logs)   | Yes                        | Partial       |
| LiteLLM               | None         | Free (you pay infra); Enterprise from ~$250/mo | Yes                        | Yes           |

The good news: in 2026, **none of the major gateways mark up tokens** — they all pass provider rates through. The competition has moved to the platform fee, BYOK terms, and whether you can self-host to pay nothing at all.

## The costs that don't show up on the pricing page

A few line items are easy to miss when you're comparing:

- **Payment-processing fees.** Several gateways (Vercel, OpenRouter, Cloudflare's Unified Billing) pass through card-processing costs on top of, or as part of, the platform fee. On small top-ups these can dominate — OpenRouter's $0.80 minimum is 8% on a $10 purchase.
- **Log-retention and seat tiers.** Observability-led gateways meter on logs or seats. Portkey's Production plan includes 100k logs/month, then bills $9 per additional 100k. Budget for the volume you'll actually generate.
- **Self-host infrastructure.** "Free and open source" still costs the servers, Redis, and on-call time to run it. That's real money — it's just yours to control.

## How to pay the least

Three levers, in order of impact:

1. **Bring your own keys.** If you already have provider accounts or volume discounts, BYOK lets you pay the provider directly. With LLM Gateway that's a 0% platform fee; with OpenRouter it's free up to 1M requests a month, then 5%.
2. **Self-host.** If data residency or absolute cost control matters, run the gateway yourself. LLM Gateway is AGPLv3 and self-hostable end to end; LiteLLM is a self-hosted proxy. Both drop your platform fee to zero.
3. **Cache and route.** The cheapest token is the one you never send. Built-in response caching makes repeat requests free, and routing simple requests to budget models keeps your blended cost down. Run your real traffic through the [Token Cost Calculator](/token-cost-calculator) before you commit.

## Frequently Asked Questions

### Do AI gateways mark up your tokens?

In 2026, the major ones don't. LLM Gateway, OpenRouter, Vercel AI Gateway, Cloudflare, Eden AI, Portkey, and LiteLLM all pass provider token rates through without a per-token markup. They make money on a platform/credit fee or a subscription instead — so compare those, not the token rates.

### What is the cheapest AI gateway?

For most teams, the cheapest path is bringing your own provider keys (0% fee on LLM Gateway) or self-hosting an open-source gateway (LLM Gateway or LiteLLM), which removes the platform fee entirely. On the managed tier, LLM Gateway's flat 5% credit fee is among the lowest, and lower than OpenRouter's 5.5%.

### Is a platform fee or a token markup worse?

A token markup is worse. It scales with every token you ever send, so it compounds as you grow. A flat platform fee on credits is a one-time percentage when you load funds — predictable and far smaller over time.

## Pay provider rates, not gateway rates

The whole point of a gateway is to save you money and effort, not add a tax. LLM Gateway passes provider token rates through with no markup, charges a flat 5% on credits (or 0% with your own keys), and is free to self-host if you'd rather pay nothing at all.

**[Try LLM Gateway free](https://llmgateway.io/signup)** | **[Run the Token Cost Calculator](/token-cost-calculator)** | **[See the 8 best AI gateways in 2026](/blog/best-ai-gateways)**
