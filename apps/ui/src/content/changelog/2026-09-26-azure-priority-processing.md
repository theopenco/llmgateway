---
id: "104"
slug: "azure-priority-processing"
date: "2026-09-26"
title: "Azure Priority Processing"
summary: "Request Azure's low-latency Priority tier with the same service_tier field you already use for OpenAI. The gateway reads back the tier Azure actually served, so a request Microsoft downgrades is billed at standard rates rather than the premium you asked for."
tags: ["llmgateway"]
image:
  src: "/changelog/azure-priority-processing.png"
  alt: "A glowing fast-forward chevron on a circuit-board chip surrounded by stopwatch and gauge icons, representing Azure priority processing on LLM Gateway"
  width: 1536
  height: 1024
---

Azure sells a low-latency lane for its OpenAI models, but until now the gateway
stripped the field that selects it — a Priority request routed through LLM
Gateway quietly ran at standard speed. **Azure Priority processing** is now a
first-class service tier, requested exactly the way you already request it on
OpenAI.

## The same field you already use

Azure accepts the OpenAI-compatible `service_tier` body field on its v1 chat
completions and responses endpoints, with the same values. There is no
Azure-specific parameter to learn: point the model string at an Azure mapping
that offers the tier and send `service_tier: "priority"`.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "azure/gpt-6-sol",
    "service_tier": "priority",
    "messages": [{ "role": "user", "content": "Summarize this incident report." }]
  }'
```

Azure offers Priority only — it publishes no Flex rate card — so a Flex request
is still rejected for Azure rather than silently downgraded. Which models carry
the tier, and the premium each one bills, are listed on the
[models page](https://llmgateway.io/models?provider=azure).

## Downgrades are billed at what actually ran

Priority is a lane, not reserved capacity. Azure serves a Priority request at
standard when your subscription is not entitled to the tier, during peak load,
when traffic ramps faster than the rate limit allows, and for long-context
prompts on some models.

Azure reports the tier it actually served, and the gateway bills that rather
than the tier you requested. A downgraded request is charged at standard rates
and comes back with `used_service_tier: null`, next to the
`requested_service_tier` you sent, so the difference is visible per request in
your logs instead of showing up as an unexplained premium on your invoice.

| Requirement     | Detail                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Deployment type | Global Standard, or Data Zone (US) — varies per model                   |
| Model version   | `2025-12-01` or later                                                   |
| Subscription    | Must be entitled to priority processing                                 |
| Provider key    | Either type — the v1 and legacy deployment surfaces both carry the tier |
| Not supported   | Regional standard and EU data zone deployments                          |

Retries and fallback never downgrade a tier you asked for: routing is narrowed
to mappings that can serve it before a provider is picked, so a request that
cannot run at Priority fails with a `400` instead of quietly running at
standard.

---

**[Service tiers docs →](https://docs.llmgateway.io/features/service-tiers)** | **[Azure integration guide →](https://docs.llmgateway.io/integrations/azure)**
