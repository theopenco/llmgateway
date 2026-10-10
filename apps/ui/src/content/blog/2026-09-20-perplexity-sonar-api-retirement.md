---
id: "blog-perplexity-sonar-api-retirement"
slug: "perplexity-sonar-api-retirement"
date: "2026-09-20"
title: "The Perplexity Sonar API Retirement: What Changes"
summary: "Perplexity retires its Sonar chat completions API on September 27, 2026. On LLM Gateway, perplexity/sonar moves to Perplexity's Agent API on September 25 with no changes to your requests and lower prices, while sonar-pro and sonar-reasoning-pro stop being routable on September 27. Here is exactly what changes, why, and what to do about it."
categories: ["Announcements", "Product"]
faqs:
  - question: "Do I need to change my code for the Perplexity Sonar API retirement?"
    answer: "Not if you use perplexity/sonar. Keep calling /v1/chat/completions with the same model id. The gateway switches the upstream transport to Perplexity's Agent API on September 25, 2026, and the request shape, streaming behavior, JSON schema output and the top-level search_results array are unchanged. If you use perplexity/sonar-pro or perplexity/sonar-reasoning-pro, you need to move that traffic before September 27, 2026."
  - question: "Why are sonar-pro and sonar-reasoning-pro not being migrated?"
    answer: "Perplexity's Agent API rejects both model ids outright, so there is no equivalent to point them at. The Agent presets that could stand in for them run a different underlying model with different search behavior and different pricing, and substituting that under an unchanged model id would change results and costs without the caller knowing. A visible error is better than a silent swap."
  - question: "Does perplexity/sonar still search the web on every request?"
    answer: "Yes. Perplexity's Agent API leaves the search decision to the model by default, so the gateway attaches a web_search tool and requires it on every perplexity/sonar request. That preserves the always-grounded behavior Sonar had on the chat completions API."
  - question: "Does perplexity/sonar get cheaper?"
    answer: "Yes. The flat per-request fee that Sonar charged on every call disappears, and searches are metered individually instead. A typical grounded question measured about a third cheaper than on the old path. Current rates are on the models page."
image:
  src: "/blog/perplexity-sonar-api-retirement.png"
  alt: "A glowing compass rose on a central chip with light traces rerouting from an old endpoint plug to a new one, beside dated source cards on a circuit board"
  width: 1536
  height: 1024
---

Perplexity is shutting down the Sonar chat completions API on **September 27,
2026**. Every Perplexity model on **LLM Gateway** runs on that endpoint today,
so the **Perplexity Sonar API retirement** affects all three of them — but not
in the same way, and not on the same date.

The short version: `perplexity/sonar` keeps its model id and keeps working, on a
new transport, from September 25. `perplexity/sonar-pro` and
`perplexity/sonar-reasoning-pro` have nowhere to go and stop being routable on
September 27.

| Date             | Model                                                    | What happens                                                    |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| **September 25** | `perplexity/sonar`                                       | Moves to Perplexity's Agent API. No action needed, price drops. |
| **September 27** | `perplexity/sonar-pro`, `perplexity/sonar-reasoning-pro` | Stop being routable. Requests return an error.                  |

## What Replaces the Sonar API

Perplexity's successor is the Agent API, a single `POST /v1/agent` endpoint
where search is a tool the model can call rather than something baked into the
model. That is a real behavioral difference: on the old Sonar endpoint every
request searched, while on the Agent API the model decides.

Preserving Sonar's behavior therefore takes more than swapping a URL. For
`perplexity/sonar` the gateway attaches a `web_search` tool and requires it, so
every request still searches the web the way it always did. You do not send the
tool yourself and you do not pay for a search you did not ask for — you get the
grounded model you were already calling.

## Nothing Changes in Your Requests

Keep calling the same endpoint with the same model id:

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "perplexity/sonar",
    "messages": [{"role": "user", "content": "What shipped in space news this week?"}]
  }'
```

Everything that came back before still comes back:

- **The answer**, non-streaming and streaming alike.
- **JSON schema output**, unchanged.
- **The top-level `search_results` array**, with one entry per source and each
  source's `url`, `title`, `snippet`, `date` and `last_updated`. On streaming
  responses it arrives on the chunk that delivers the sources.
- **`citations`**, for clients that read Perplexity's original field.

One thing is new. Sources now also arrive as standard `annotations` on the
assistant message — the same `url_citation` shape every other search-grounded
model on the gateway emits:

```json
{
  "annotations": [
    {
      "type": "url_citation",
      "url": "https://example.com/article",
      "title": "Article Title",
      "date": "2026-09-16",
      "last_updated": "2026-09-17"
    }
  ]
}
```

Perplexity never populated that field on the old endpoint, so if you were
special-casing Sonar in your citation handling, you can stop. The
[web search docs](https://docs.llmgateway.io/features/web-search) cover the
normalized citation shape across providers.

## It Gets Cheaper

Sonar's old pricing charged a flat fee on every single request on top of tokens,
whether or not the answer needed much searching. The Agent API drops that fee
and meters searches individually, billed off the search count Perplexity
reports back. Output tokens are priced higher than before, input tokens
considerably lower, and cached input is now priced separately.

Netted out, a grounded question measured about a third cheaper than on the old
path in our own testing. Your mileage depends on how output-heavy your prompts
are; current rates for the model are always on the
[models page](https://llmgateway.io/models). As before, the search charge is
reported separately as `cost_details.web_search_cost` so you can see exactly
what grounding cost you.

## Why sonar-pro and sonar-reasoning-pro Are Not Being Migrated

Perplexity's Agent API rejects both model ids outright — they are not models
there, and there is no drop-in successor. What the Agent API offers instead are
presets that trade off search depth and cost.

We could have pointed the two retiring ids at a preset and called it a
migration. We decided not to, for one reason: those presets run a _different
underlying model_, with different search behavior, different citation style and
different pricing. Silently swapping that in under an unchanged model id means
your evaluation results move, your costs move, and nothing in your code says
why. A model id is a contract. When we cannot honor it, an error you can see
beats a substitution you cannot.

So from September 27, requests to `perplexity/sonar-pro` and
`perplexity/sonar-reasoning-pro` return an error instead of a quietly different
answer.

## What to Do If You Use Them

**Check first.** Filter by model in
[Model Usage](https://docs.llmgateway.io/learn/model-usage) in your dashboard to
see whether either id shows up in your recent traffic. Most projects using
Perplexity for grounded answers are on `perplexity/sonar` and have nothing to
do.

**If you are affected, you have two paths:**

1. **Move to `perplexity/sonar`.** A one-line change to the `model` string. You
   keep Perplexity's search index and citation behavior, and you get the new
   pricing. This is the closest thing to a like-for-like move.
2. **Move to another search-grounded model.** Several providers offer native web
   search through the same `web_search` tool, so the request shape you already
   use carries over. The
   [models page filtered to web search](https://llmgateway.io/models?filters=1&webSearch=true)
   lists them with current pricing. If you were on `sonar-reasoning-pro`
   specifically for the reasoning, pair a reasoning model with the `web_search`
   tool — see the [reasoning docs](https://docs.llmgateway.io/features/reasoning).

Either way, [routing](https://docs.llmgateway.io/features/routing) means you can
test a replacement against real traffic before you commit: send a slice of
requests to the candidate model and compare the answers and the costs in your
dashboard.

## Deprecations Are Part of the Job

Providers retire endpoints. That is the reality of building on models you do not
host, and it is a large part of what a gateway is for: absorbing the churn so a
transport change upstream does not become a code change downstream. In this case
one model id survives untouched because the gateway rewrote the request for you,
and two do not because honesty was worth more than a silent fallback.

If you need help moving a workload off the retiring models, reply to the
announcement email or reach us at
[contact@llmgateway.io](mailto:contact@llmgateway.io) — we are happy to look at
your traces with you.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Web search documentation](https://docs.llmgateway.io/features/web-search)**
- **[How routing picks a provider](/blog/llm-routing-carriers-guide)**
