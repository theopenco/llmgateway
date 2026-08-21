---
id: "67"
slug: "upgrade-rollover-new-providers"
date: "2026-07-22"
title: "Upgrade Rollover, New Providers & Gemini TTS"
summary: "DevPass upgrades now roll your unspent allowance into the new tier — or schedule the switch for your next renewal. Plus two new providers including SCX.ai's Turbo inference (up to 4x faster), Gemini 3.6 Flash and 3.5 Flash Lite, Gemini TTS on two providers, and Empryo as a first-class coding agent."
image:
  src: "/changelog/upgrade-rollover-new-providers.png"
  alt: "Product roundup: DevPass upgrade rollover, new inference providers, and Gemini TTS on LLM Gateway"
  width: 1536
  height: 1024
---

Upgrading DevPass mid-cycle used to mean forfeiting everything unspent from the cycle you had already paid for — a common (and fair) refund request. Upgrades now keep what you paid for: **unused credits roll over** into the new tier, and you choose when the switch happens.

## Upgrades That Keep Your Unspent Credits

An immediate upgrade now grants the new tier's full allowance **plus the unused remainder** of the cycle it replaces. On Lite with $12.50 of $87 used, upgrading to Pro starts the new cycle at $237 + $74.50 = **$311.50**. The rollover lasts until your next renewal, which resets to the tier's base allowance as usual.

The upgrade dialog also asks when you want it:

| Option              | Charge                          | Allowance                                         |
| ------------------- | ------------------------------- | ------------------------------------------------- |
| **Upgrade now**     | Full new-tier price today       | New tier + rollover, cycle restarts today         |
| **At next renewal** | Nothing today; bills at renewal | Keep current tier until then, full new tier after |

Both amounts and dates are shown in the dialog before you confirm. Scheduled upgrades reuse the same mechanics as scheduled downgrades, so you can still cancel the switch any time before renewal.

## New Providers

- **[SCX.ai](https://llmgateway.io/providers/scx-ai)** — an Australian sovereign AI platform serving OpenAI-compatible **Turbo inference endpoints, up to 4x faster** than comparable providers, on renewable-powered infrastructure with zero-day data retention. Its model cards carry an "Up to 4x faster" badge so the speed advantage is visible at a glance.
- **[Gonka24](https://llmgateway.io/providers/gonka24)** — open-weight large language models behind an OpenAI-compatible inference gateway.
- **Nebius** picked up a batch of new model mappings, widening routing options for the open-weight catalog.

Every provider is available through the same OpenAI-compatible API with automatic fallback — browse the full catalog on the [providers page](https://llmgateway.io/providers).

## New Models

- **Gemini 3.6 Flash** and **Gemini 3.5 Flash Lite** — Google's latest fast tier, available on AI Studio and Vertex.
- **Gemini TTS** — Google's speech-generation models are now available on both AI Studio and Vertex through the gateway's speech endpoint.

See current pricing and capabilities for everything on the [models page](https://llmgateway.io/models).

## Product Polish

- **Empryo coding agent** — [Empryo](https://empryo.com) joins the roster of first-class coding agents: requests from it are detected and attributed automatically, with per-agent usage on your DevPass dashboard.
- **Request timeouts documented** — the gateway's per-request time limits (20 minutes streaming, 10 minutes non-streaming) and how they interact with long-running agentic pipelines now have a [dedicated docs page](https://docs.llmgateway.io/features/timeouts), including the env vars self-hosted deployments can raise.

---

**[DevPass pricing →](https://devpass.llmgateway.io/pricing)** | **[Browse providers →](https://llmgateway.io/providers)**
