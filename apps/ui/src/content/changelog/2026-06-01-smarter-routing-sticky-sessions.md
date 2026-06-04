---
id: "51"
slug: "smarter-routing-sticky-sessions"
date: "2026-06-01"
title: "Smarter Routing: Sticky Sessions, Bedrock Regions & More"
summary: "Pin conversations to one provider for warm caches with x-session-id, route Bedrock by region, and reach Gemini via Google AI Studio plus Vertex embeddings."
image:
  src: "/changelog/smarter-routing-sticky-sessions.png"
  alt: "Smarter routing on LLM Gateway: sticky sessions, Bedrock regions and more"
  width: 1536
  height: 1024
---

A batch of routing upgrades that make multi-turn apps faster, give you finer control over where requests land, and expand the providers you can reach.

## Sticky Session Routing

Multi-turn conversations now stay on the same upstream provider, so provider-side prompt caches stay warm across turns — fewer cold reads, lower latency, and lower cost.

Just pass a stable identifier on the request:

```bash
curl -X POST "https://api.llmgateway.io/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "x-session-id: conversation-1234" \
  -H "Content-Type: application/json" \
  -d '{ "model": "anthropic/claude-opus-4-8", "messages": [...] }'
```

- Send the same `x-session-id` for every turn in a conversation
- If you don't set the header, the gateway falls back to Anthropic's `metadata.user_id` or the OpenAI `user` field
- Works alongside auto-select — your session sticks to the provider it first landed on

## Stable Preferred-Provider Routing

When you set a preferred provider, routing now sticks to it consistently instead of drifting between equivalent options — predictable behavior for teams that have standardized on a specific upstream.

## AWS Bedrock Region Routing

Bedrock requests now default to a **global** cross-region inference profile, with the option to pin a specific region group (US, EU, APAC) or an exact region. One set of credentials works across all of them.

- Defaults to `global` for the best availability
- Override with `LLM_AWS_BEDROCK_REGION` to keep traffic in a specific geography for data-residency needs

## Google AI Studio Provider

Gemini models are now reachable through **Google AI Studio** (`google-ai-studio`) in addition to Vertex AI — bring whichever Google credentials you already have.

## Embeddings Get More Reach & Resilience

Following the [embeddings launch](/changelog/openai-compatible-embeddings), the `/v1/embeddings` endpoint now:

- Supports **Google Vertex AI** embedding models
- Falls back to another key on the same provider if one key fails
- Surfaces key-health and routing metadata, just like chat completions

---

**[Read the routing docs →](https://docs.llmgateway.io)** | **[Browse all models →](https://llmgateway.io/models)**
