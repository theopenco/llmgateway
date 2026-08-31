# Airside — What It Costs To List

Last updated: 2026-08-31

> Airside is the carrier console where an AI model provider lists its models on LLM Gateway. There is no subscription and no minimum volume: you set the prices developers pay, you choose the gateway margin you accept, and you share margin only on traffic you win.

## Listing a carrier

- Price: a one-time $2,500 listing fee per provider company on llmgateway.io, charged via Stripe, payable before a claim is approved. Non-refundable, including if the claim is later rejected or revoked. (Self-hosted deployments without a configured fee list for free.)
- Providers we already work with can skip the fee with an invite code we share with them — entered during onboarding instead of paying.
- Recurring platform fee: none.
- Minimum volume or revenue commitment: none.
- One listing covers your whole team: invite up to 10 crew members to the console.

## What you charge

- You set per-token input and output prices, and optionally a cached-input price and a flat per-request price.
- Your filed price is what developers are billed for requests routed to your models. LLM Gateway does not mark your token prices up.
- Prices change only through an approved tariff filing. The previously approved price stays in effect until the new filing is approved.

## What you keep

- You keep your billed traffic less the gateway margin you accept.
- The margin is a control in your console, not a fixed rate: raising the margin you accept improves your routing score, lowering it keeps more revenue per request.
- An optional routing discount lowers your effective price in the routing election only, winning more traffic. It changes neither the public price developers pay nor what you're paid per token.
- Margin and discount changes are filed like tariffs: they are reviewed by the LLM Gateway team and only reach routing once approved.
- The console reports traffic, not amounts owed. Settlement — schedule, currency, minimums — is governed by a separate written agreement.

## How traffic is allocated

- Every request runs a routing election across eligible providers. The lowest score wins.
- Scored on: price after your discount and accepted margin (heaviest weight), availability, prompt-cache support, throughput, then latency to first token.
- No paid placement: ranking cannot be bought outside these mechanics, and no traffic volume is guaranteed.
- Developers can pin a provider or disable fallback, which overrides automatic selection.

## Requirements

- A verified company email whose registrable domain matches your API endpoint's domain or published website. Free and disposable email domains are rejected.
- An OpenAI-compatible endpoint you operate.
- Claims and initial listings are reviewed by the LLM Gateway team before going live.

## Notes

- Human-readable overview: https://airside.llmgateway.io
- Carrier terms: https://airside.llmgateway.io/legal/terms
- Developer-side pricing for the gateway itself: https://llmgateway.io/pricing.md
