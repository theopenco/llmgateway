# LLM Gateway — Pricing

Last updated: 2026-08-15

> One OpenAI-compatible API for the models and providers in the live catalogue. Per-token prices match each provider's published rates; LLM Gateway charges a flat 5% platform fee when you buy credits. Bringing your own provider keys is free, and self-hosting is free under AGPLv3.

## Managed cloud — pay-as-you-go credits

- Price: $0 subscription. Prepaid credits, $10 minimum / $5,000 maximum per top-up.
- Platform fee: flat 5% added at credit purchase (plus 1.5% for international cards).
- Token pricing: provider list rates per token — no markup on tokens. Live per-model prices: https://llmgateway.io/models
- Includes: access to the live model catalogue, automatic failover, response caching, usage analytics, and cost tracking.

## Bring Your Own Keys (BYOK)

- Price: free. Your provider bills you directly at its own rates.
- Platform fee: none — the 5% fee applies only to credit purchases.

## Self-hosted

- Price: free and open source (AGPLv3): https://github.com/theopenco/llmgateway

## Enterprise

- Price: custom — volume discounts, custom routing, unlimited data retention, 99.9% uptime SLA.
- Details: https://llmgateway.io/enterprise — contact contact@llmgateway.io

## Refunds

- Self-serve, no support ticket: refund a purchase from the billing dashboard within 14 days while less than 20% of it has been used.
- Applies to credit top-ups, DevPass plan payments, and Lounge memberships. DevPass Reset Passes: within 7 days, while the pass is unused.

## Related products

- DevPass — flat-price dev plans for AI coding tools: Lite $29/month ($87 model usage included), Pro $79/month ($237 included), Max $179/month ($537 included). https://devpass.llmgateway.io
- Lounge — consumer AI chat memberships, billed monthly: Starter $9, Plus $19, Pro $49. https://lounge.llmgateway.io

## Notes

- The API is OpenAI-compatible: point your existing SDK at the gateway base URL.
- Free models are available on the free tier without buying credits.
- Human-readable pricing page: https://llmgateway.io/pricing
