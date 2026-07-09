---
id: "56"
slug: "chat-plans-service-tiers-product-roundup"
date: "2026-06-10"
title: "Chat Plans, Service Tiers, SDK Sandbox & More"
summary: "Monthly Chat subscriptions from $9, Flex and Priority service tiers, sandbox test keys for the LLM SDK, a no_training model filter, public DevPass profiles, and a stack of product polish."
image:
  src: "/changelog/chat-plans-service-tiers-product-roundup.png"
  alt: "Product roundup: chat plans, service tiers, SDK sandbox keys and more on LLM Gateway"
  width: 1024
  height: 1024
---

A roundup of everything else that shipped recently — new ways to pay, new ways to route, and a safer way to build on the LLM SDK.

## Chat Subscription Plans

[Chat](https://chat.llmgateway.io) now has monthly plans, so you can use every studio without topping up credits manually:

- **Starter — $9/mo** with **2×** credits ($18 of usage)
- **Plus — $19/mo** with **2.5×** credits ($47.50 of usage)
- **Pro — $49/mo** with **3×** credits ($147 of usage)

Plus and Pro unlock the full catalog including frontier models; Starter covers everything except the most expensive flagships. Higher tiers earn a more generous multiplier — same philosophy as DevPass.

## Flex & Priority Service Tiers

Supported OpenAI and Google models now accept the OpenAI-compatible `service_tier` parameter:

```json
{ "model": "google-vertex/gemini-2.5-pro", "service_tier": "flex" }
```

- **`flex`** — about **50% cheaper**, best-effort processing for batch and background work
- **`priority`** — processed ahead of standard traffic when latency matters
- The gateway forwards the tier only where the provider/model supports it, and rejects unsupported combinations with a clear error

[Service tiers docs →](https://docs.llmgateway.io/features/service-tiers)

## Sandbox Test Keys for the LLM SDK

Building on the [embeddable wallets SDK](https://llmgateway.io/blog/embeddable-ai-credits-stripe-for-ai)? You can now create **test secret keys** alongside live ones. Top-ups made with a test key run through the Stripe sandbox — build and test your whole top-up flow without real charges. There's also a new **SDK page under project Settings** to manage secret keys, end-user session settings, markup, and allowed origins.

[SDK settings docs →](https://docs.llmgateway.io/learn/sdk-settings)

## Filter Models by Training Policy

`/v1/models` now accepts a `no_training` filter, returning only models whose providers don't train on your request data — handy for compliance-sensitive routing.

## Model Categories & Fair-Use Caps

Every model is now categorized as **Premium** or **Standard**, powering dashboard filters and analytics. For **DevPass** coding plans, premium models get a rolling weekly fair-use cap (12%/15%/18% of monthly credits for Lite/Pro/Max) so flagship capacity stays available for everyone — the API and pay-as-you-go credits are unaffected.

[How categories and caps work →](https://docs.llmgateway.io/learn/model-categories)

## Public DevPass Profiles

Claim a username and share your AI coding activity. Your profile shows your activity heatmap and top coding agents at `llmgateway.io/profiles/<username>` — private by default, shareable when you flip it on, complete with a dynamic OG image.

## Product Polish

- **Org switcher in the studios** — switch organizations without leaving Image, Video, or Audio Studio, and generations are billed to the right org even if you switch mid-flight
- **Plain-English legal pages** — terms and privacy now open with a human-readable summary
- **Delete account in Code settings** — DevPass users can remove their account directly from settings
- **Cost-aware sticky sessions** — sticky session routing now factors cost into provider selection

---

**[Open your dashboard →](https://llmgateway.io/dashboard)** | **[Try Chat →](https://chat.llmgateway.io)**
