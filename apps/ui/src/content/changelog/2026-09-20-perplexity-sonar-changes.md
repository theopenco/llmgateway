---
id: "100"
slug: "perplexity-sonar-changes"
date: "2026-09-20"
title: "Perplexity Sonar Changes September 25"
summary: "Perplexity retires its Sonar chat completions API on September 27. On September 25 we move perplexity/sonar to Perplexity's Agent API with no changes to your requests and lower prices, and perplexity/sonar-pro and perplexity/sonar-reasoning-pro stop being routable on September 27."
tags: ["llmgateway"]
image:
  src: "/changelog/perplexity-sonar-changes.png"
  alt: "A glowing compass rose on a lit central chip with two darkened chips beside it on a circuit board, next to a globe, a stack of source cards and a calendar"
  width: 1536
  height: 1024
---

Perplexity is shutting down the Sonar chat completions API that all three
`perplexity/*` models run on today. Here is what happens on LLM Gateway, and
when.

## Two Dates

| Date             | Model                                                    | What happens                                                                                  |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **September 25** | `perplexity/sonar`                                       | Moves to Perplexity's Agent API. Same model id, same requests, lower price. No action needed. |
| **September 27** | `perplexity/sonar-pro`, `perplexity/sonar-reasoning-pro` | Stop being routable. Requests return an error.                                                |

## `perplexity/sonar` Keeps Working

Keep calling `/v1/chat/completions` with `perplexity/sonar`. Answers, streaming,
JSON schema output and the top-level `search_results` array — including each
source's `date` and `last_updated` — behave as before, and every request still
searches the web. Sources now also arrive as standard `annotations` on the
assistant message, so clients that read OpenAI-style citations get them without
parsing a Perplexity-specific field.

Pricing improves at the same time: the flat per-request fee disappears and
searches are metered individually, so a typical grounded question costs less
than it does today. Current rates are on the
[models page](https://llmgateway.io/models).

## The Pro Models Retire

Perplexity's Agent API rejects both `sonar-pro` and `sonar-reasoning-pro`
outright, so there is nothing to migrate them to. We are not silently
redirecting them either: the Agent presets that would stand in for them run a
different underlying model with different search behavior and different
pricing, and an unchanged model id should not hide that. Move affected traffic
to `perplexity/sonar` or to any other search-grounded model on the
[models page](https://llmgateway.io/models?filters=1&webSearch=true).

---

**[Read the full announcement →](https://llmgateway.io/blog/perplexity-sonar-api-retirement)** | **[Web search docs →](https://docs.llmgateway.io/features/web-search)**
