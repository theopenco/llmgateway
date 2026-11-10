---
id: "124"
slug: "prompt-management-data-streams-roundup"
date: "2026-11-10"
title: "Prompt Management, Data Streams & More"
summary: "A catch-up on the last six weeks: prompts with versions and labels you call by name, Enterprise data streams to your SIEM, the cost of a request in the reply on every HTTP endpoint, a public status page for each provider, model price change alerts, and rate limits on your own provider keys."
tags: ["llmgateway", "devpass"]
image:
  src: "/changelog/prompt-management-data-streams-roundup.png"
  alt: "A glowing scroll with three version tabs and a flag on a circuit board chip, surrounded by a radio beacon, a price tag with a coin, a heartbeat monitor, a notification bell and a picture frame with a loop arrow"
  width: 1536
  height: 1024
---

A catch-up on the notable changes since late September that never got an entry of their own. Two are new products; the rest make existing endpoints and the dashboard more exact.

## Prompt Management

Prompts lived in application code, so changing one meant a redeploy, with no history to roll back to. **Prompt management** keeps them in the gateway. Each prompt has immutable versions, and labels such as `production` and `staging` point at them. Deploying is moving a label, and rolling back is pointing it at an earlier version.

Call a prompt by name through `model`, from any OpenAI-compatible client:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "@prompt/support-reply",
    "messages": [{ "role": "user", "content": "How do I rotate my key?" }]
  }'
```

Add `@staging` or `@3` to follow another label or pin a version. Prompts with `{{variables}}` take a `prompt` object instead, on `/v1/chat/completions` and `/v1/responses`. Each response carries `x-llmgateway-prompt-id` and `x-llmgateway-prompt-version`, and the same values are stored on the log entry, so two versions can be compared side by side.

## Data Streams

Security teams want admin activity in their SIEM and request metadata in their own storage. **Data streams** deliver both as signed HTTPS requests to an endpoint you run.

| Stream          | Sends                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| SIEM forwarding | Audit logs: every admin action in the organization                           |
| Log export      | One event per request: model, provider, tokens, cost, latency, finish reason |

Events carry metadata only. Prompts, completions and tool calls are never exported. Batches of up to 500 events arrive in order, signed with HMAC-SHA256 in `X-LLMGateway-Signature`, and a failed batch is retried, so delivery is at least once. Available on the **Enterprise plan**, enabled per organization on request; log export is switched on separately.

## Cost in the Reply on Every HTTP Endpoint

`usage.cost` used to come back on chat, responses, image and video requests only. Every billed reply with a JSON or SSE body now reports what it cost in USD, with `usage.cost_details` breaking it down and nothing to opt into.

| Endpoint                                                                                    | Where the cost is                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `/v1/chat/completions`, `/v1/responses`, `/v1/messages`                                     | `usage`, and the final usage event of a stream             |
| `/v1/embeddings`, `/v1/decisions`, `/v1/rerank`, `/v1/ocr`, `/v1/moderations`, `/v1/search` | `usage`                                                    |
| `/v1/audio/transcriptions`                                                                  | `usage`, with the `seconds` of audio billed                |
| `/v1/audio/speech`                                                                          | `usage` on `speech.audio.done` with `stream_format: "sse"` |
| `/v1/videos`                                                                                | `usage` on the job status and the signed callback          |

Two replies cannot carry a cost: speech returned as binary audio, which is why `stream_format: "sse"` now works on every speech model, and realtime sessions.

## Provider Status Pages

The gateway measures each provider on real traffic, but that only showed up as a 7-day number on provider pages. **[llmgateway.io/status](https://llmgateway.io/status)** lists every provider with the uptime the gateway measured over the last 24 hours, next to its official status where the provider publishes a status feed. Providers reporting issues sort to the top. Each provider page adds a 90-day daily uptime bar from gateway traffic and the models that can fail over to another provider, plus official components and incidents from the last 90 days where a feed exists.

## Model Price Change Alerts

Price changes used to show up on the bill first. Turn on **Model price changes** under notifications to hear about them in-app or by email, with the old and new price for each provider and region. Choose which models count: the ones you spent over $1 on in the last 30 days (the default), all models, or a list you pick. When more than three covered models change at once you get one digest instead.

## Rate Limits on Your Own Provider Keys

Upstream accounts are usually limited per key and in tokens. Each provider key you bring can now cap its requests per minute or day and its prompt and completion tokens per minute or day. A key at a cap is skipped: the next key for that provider serves the request, routing prefers other providers, and in hybrid mode the request falls back to credits.

| Limit mode | A capped key still serves                                      |
| ---------- | -------------------------------------------------------------- |
| **Strict** | Nothing. This is the default                                   |
| **Soft**   | Sessions already pinned to the key's provider                  |
| **Lax**    | Pinned sessions and requests that name the provider explicitly |

In every mode, a conversation that replays encrypted reasoning issued by a key keeps that key.

## Images: GIF Output, Complexity and Edit Markup

Image requests gain three options. GIF output and complexity work on GPT Image 2.6 Sunburst and Flare, for generations and edits; markup works on OpenAI and Azure image edits where the model supports it.

| Option                 | What it does                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `output_format: "gif"` | Returns an animation; `frame_count` (2–16) and `frame_duration_ms` (20–2000) control it |
| `complexity`           | `low`, `medium` or `high` planning before rendering, independent of `quality`           |
| `markup`               | A PNG the size of the first input image that guides a focused edit                      |

Alibaba's **Wan 2.7 Image** and **Wan 2.7 Image Pro** also join the image models, and **Wan 3.0 Video** and **Wan 3.0 Video Prime** bring 480p to 1080p clips of 2 to 30 seconds, with optional audio, first and last frames, and up to ten reference images.

## Realtime and Speech

Realtime sessions on models with vision accept `input_image` content, as a data URL or a public HTTPS URL, and compatible providers accept native `mcp` tools in the session or per response. On `/v1/audio/speech`, OpenAI-compatible speech models, including through Azure, now stream audio as it is generated; models that return audio in one piece are unchanged. More OpenAI embedding, speech and realtime models are served through Azure.

## Routing

- **Smart routing sessions.** With `model: "smart"`, a session keeps the model and reasoning effort it resolved to and rechecks them only between turns, and each smart-routed request records on its log entry why it chose that model.
- **Speed counts for more.** Automatic routing weighs throughput and latency more heavily against price than before.
- **Search.** `/v1/search` accepts `model: "auto"` and routes to the cheapest active search model, and chat completions accept OpenAI's `web_search_options` field.
- **Claude Code auto mode.** `/v1/messages` forwards the `safeguards` field and returns `safeguard_results`, so Claude Code keeps Anthropic's free server-side review of risky tool calls instead of falling back to its own billed classifier requests.

## Caching

- **Automatic cache duration.** In Automatic cache mode, a project can keep provider prompt caches for **1 hour** instead of 5 minutes where the model and provider support it, for requests without their own cache markers. One-hour cache writes cost more than 5-minute ones. Set it under Project Settings → Caching, or in DevPass settings.
- **Custom providers.** Each custom provider key has a **Forward prompt-cache markers** switch, on by default for new keys, so cache markers your client sends reach models behind your own OpenAI-compatible endpoint. Custom providers are an Enterprise feature.

## Dashboard and API

- **Rate card in `/v1/models`.** Each mapping lists its context-length tiers, peak rates, regions, service-tier multipliers and the active discount.
- **Usage chart.** The dashboard usage chart has a **Day / Week / Month** toggle, so a range of several months is a few bars instead of a hundred.
- **Prompt cache rate.** Organization analytics chart cached input as a share of total input per model, project, API key or user. Organization Analytics is an Enterprise feature.
- **Organization limit alerts.** Owners and admins are told when a seat or API key limit blocks a directory sync, an SSO sign-in, an invite or a new key.
- **Safety identifiers.** The opaque identifier sent to providers for abuse attribution is generated per API key instead of per organization.
- **Refunds.** A refund now emails the credit note to your billing address and says how long the money takes to arrive, usually 5–10 business days.

## DevPass

The Usage page shows the daily usage cap, the weekly premium allowance and the monthly allowance as one tile each, with the exact reset time. The daily cap spreads the allowance across the cycle: each rolling 24 hours can use 8% of the monthly allowance on Lite, 9% on Pro and 10% on Max, across all models, and pay-as-you-go overflow lifts it. Cancelling now starts with one question and, where there is one, offers an option that fits the reason.

---

**[Prompt management docs →](https://docs.llmgateway.io/features/prompt-management)** | **[Provider status →](https://llmgateway.io/status)**
