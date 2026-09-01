---
id: "85"
slug: "claude-foundry-model-status"
date: "2026-08-28"
title: "Claude on Foundry, Model Status & More"
summary: "Claude now routes through Microsoft Foundry under a new azure-anthropic provider. The models directory gained lifecycle status filters, model pages sort providers by price, speed, or context, and API key lists flag the keys that are near or at their limit."
image:
  src: "/changelog/claude-foundry-model-status.png"
  alt: "Product roundup: a cloud chip routing to a central gateway chip beside sortable model cards and a key gauge on a circuit board"
  width: 1536
  height: 1024
---

Microsoft Foundry serves Claude only through Anthropic's Messages API — there is no OpenAI-compatible surface for those deployments — so neither existing Azure provider could route them. The new **`azure-anthropic`** provider closes that gap — and four smaller changes make the catalogue, your key list, and every timestamp easier to read at a glance.

## Claude on Microsoft Foundry

`azure-anthropic` posts to `https://<resource>.services.ai.azure.com/anthropic/v1/messages` and reuses the gateway's Anthropic request, response, and streaming path, including cache-control passthrough and server-side tool search. Add a provider key with your Foundry resource name, then call it like any other provider:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
	-H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{
		"model": "azure-anthropic/claude-opus-4-8",
		"messages": [{ "role": "user", "content": "Hello" }]
	}'
```

Pricing matches the direct Anthropic mappings, so choosing Foundry is a deployment decision rather than a cost one — and both mappings are candidates for smart routing and fallback. Browse what routes through it on the [models page](https://llmgateway.io/models?provider=azure-anthropic).

## Model Lifecycle at a Glance

Every provider mapping in the [models directory](https://llmgateway.io/models) now carries exactly one lifecycle status, shown as a badge on the mapping and filterable from the **Status** section of the filter panel:

| Chip            | What it selects                                                          |
| --------------- | ------------------------------------------------------------------------ |
| **Deprecated**  | Still routes; the provider has announced a sunset, so migrate soon       |
| **Scheduled**   | Still routes, but deactivation is set for a date inside the next 90 days |
| **Deactivated** | No longer routes; requests return errors                                 |

Status resolves by urgency — deactivated beats scheduled beats deprecated — so a mapping never carries two at once, and a deactivation years out stays plain active rather than nagging. Chips are single-select and write to `?status=`, so a filtered view is shareable.

The default view is unchanged: it lists everything routable and hides mappings already past their deprecation or deactivation date. The chips are how you go looking for them, which is what you want before pinning a provider for the next quarter.

## Sort Providers on a Model Page

A model with a dozen provider mappings used to render in one fixed order. The **All Providers** grid on each model page now sorts by Featured, cheapest input, cheapest output, fastest, or most context, and the active choice is written to `?sort=` so a sorted comparison can be shared or bookmarked. Provider names on the cards are links, so you can jump from a price comparison straight to that provider's page — country, legal entity, and full model list.

## Keys That Tell You They Are Full

The API keys list shows a gauge for every configured limit, all-time and current period, and marks a key **approaching** at 80% of its limit and **reached** once usage meets it. Filters narrow the list to exactly those keys, next to filters for status and creator — so a workspace with fifty keys surfaces the two that are about to start returning errors.

## Local or UTC Timestamps

**Settings → Account** now carries a display time zone: your local zone or UTC. The preference drives both how timestamps render and the bucketing the analytics endpoints do, so a chart's bars and its axis labels cannot disagree. It lives in a cookie rather than your profile, so the server renders the right zone on first paint, and the DevPass dashboard picks it up from its own **Settings** page.

---

**[Azure integration docs →](https://docs.llmgateway.io/integrations/azure)** | **[Browse the models →](https://llmgateway.io/models)**
