---
id: "99"
slug: "perplexity-agent-api"
date: "2026-09-19"
tags: ["llmgateway"]
title: "Perplexity Sonar Moves to the Agent API"
summary: "perplexity/sonar keeps working past Perplexity's September 27 Sonar retirement, now served over the Agent API — at lower prices, with search results and their dates unchanged."
tags: ["llmgateway"]
image:
  src: "/changelog/perplexity-agent-api.png"
  alt: "A compass rose over a stack of dated source cards, with an arrow moving from an old endpoint plug to a new one"
  width: 1536
  height: 1024
---

Perplexity retires the Sonar chat completions API on **September 27, 2026**.
`perplexity/sonar` keeps working through that date and beyond: the gateway now
calls Perplexity's Agent API for it, and your requests do not change.

## Nothing to Change on Your Side

Keep calling `/v1/chat/completions` with `perplexity/sonar`. Answers, streaming,
JSON schema output and the top-level `search_results` array — including each
source's `date` and `last_updated` — all behave as before. Sources now also
arrive as standard `annotations` on the assistant message, so clients that read
OpenAI-style citations get them without parsing a Perplexity-specific field.

Every request still searches the web. Perplexity's Agent API leaves that to the
model by default, so the gateway forces a search to preserve the grounded
behavior Sonar always had.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "perplexity/sonar",
    "messages": [{"role": "user", "content": "What shipped in space news this week?"}]
  }'
```

## Cheaper, and Metered Per Search

Sonar billed a flat fee on every request. The Agent API drops it and charges for
searches individually, so a typical grounded question now costs meaningfully
less. Current rates are on the
[models page](https://llmgateway.io/models).

## Sonar Pro and Sonar Reasoning Pro Retire

Perplexity's Agent API has no equivalent for `perplexity/sonar-pro` or
`perplexity/sonar-reasoning-pro`, so both stop being routable on September 27.
We are not silently redirecting them: the Agent presets that replace them run on
a different underlying model with different search behavior and pricing, and
that is not something an unchanged model id should hide. Move affected traffic
to `perplexity/sonar`, or to any other grounded model on the
[models page](https://llmgateway.io/models).
