---
id: "59"
slug: "custom-model-catalog"
date: "2026-06-18"
title: "Custom Model Catalog for Custom Providers"
summary: "Bring any OpenAI-compatible model under full cost tracking. Define pricing, context limits, and capabilities per custom provider key — so requests through custom providers get billed, enforced, and reported just like a built-in model. Available on Enterprise."
image:
  src: "/changelog/custom-model-catalog.png"
  alt: "Custom Model Catalog on LLM Gateway: pricing, context limits, and capabilities defined for an OpenAI-compatible custom provider"
  width: 1536
  height: 1024
---

Custom providers let you route to any OpenAI-compatible endpoint — a self-hosted model, an internal service, or a provider we don't support natively — using `mycompany/my-model`. Until now those requests had a blind spot: LLM Gateway held no catalog entry for the model, so it couldn't know the price, context window, or capabilities. That meant **no cost attribution and no enforced limits**. The **Custom Model Catalog** closes that gap.

## Define a model

Open **Organization → Custom Models**, pick a custom provider key, and add a catalog entry. Only the model id is required — every other field is optional:

| Field                         | What it controls                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Model id**                  | The id after the provider prefix (`gpt-5.5` in `mycompany/gpt-5.5`).                                        |
| **Display name**              | An optional human-readable label for dashboards and analytics.                                              |
| **Context size / max output** | Token limits, enforced per request.                                                                         |
| **Token prices**              | Input, output, cached input, cache read/write (5m and 1h), per-request, web search, image, and audio input. |
| **Capabilities**              | `streaming`, `vision`, `tools`, `reasoning`, `jsonOutput`, `audio`.                                         |
| **Supported parameters**      | An advisory list of accepted request parameters.                                                            |

Prices are in **USD per token** and accept decimal (`0.000003`) or exponent (`3.0e-6`) notation.

## Cost attribution that matches reality

When a request matches a catalog entry, the gateway bills it at the prices you set and records the cost on the activity log — the same place your built-in model spend already shows up. No catalog entry, no change: the request stays unbilled, exactly as before.

One thing to know: a known model id (say `gpt-5.5`) routed through a custom provider is **not** billed at that model's public pricing. Only the prices you define in the catalog apply, so define the model to attribute its cost.

## Limits and capabilities, enforced upstream

When an entry sets limits or capabilities, the gateway checks them before forwarding the request:

- **Context size / max output** — requests over the configured window or output budget are rejected with `400`, before they ever reach your endpoint.
- **Capabilities** — a flag set to disabled rejects requests that use it: images against a non-`vision` model, tools against a non-`tools` model, streaming against a non-streaming model. Flags you leave unset stay permissive and your upstream provider decides.

## Lock it down with catalog-only mode

Every custom provider key has an **Only allow catalog models** switch. Turn it on and requests must reference a defined catalog model — anything else returns `400`. That guarantees every request through the key has known pricing and enforced limits. Leave it off and undefined models keep working, unbilled, as they always have.

## Availability

The Custom Model Catalog is available on the **Enterprise plan** for organization owners and admins. The gateway always honors entries that already exist, so your pricing and limits keep working even after a plan change.

---

**[Custom providers docs →](https://docs.llmgateway.io/features/custom-providers#custom-model-catalog)** | **[Contact us about Enterprise →](https://llmgateway.io/enterprise)**
