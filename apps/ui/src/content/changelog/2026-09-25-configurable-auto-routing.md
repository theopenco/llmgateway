---
id: "104"
slug: "configurable-auto-routing"
date: "2026-09-25"
title: "Configurable Auto Routing"
summary: "Choose which models `auto` may resolve to, and let a classifier rate each request so easy prompts go to a cheap model and hard ones go to a frontier model. Dynamic routes can branch on the same verdict. Available on the Enterprise plan."
tags: ["llmgateway"]
image:
  src: "/changelog/configurable-auto-routing.png"
  alt: "Three ascending glowing tiers on a circuit-board chip, surrounded by magnifier, sliders, coin and shield icons, representing the price bands of configurable auto routing on LLM Gateway"
  width: 1536
  height: 1024
---

Sending `"model": "auto"` has always picked the cheapest model that could
handle the request, from a fixed list we chose. That is the right default, but
it has no idea whether you asked it to fix a typo or to design a consensus
protocol — and you could not change which models it was allowed to pick.
**Configurable auto routing** hands both of those over to you.

## Pick the models, pick the classifier

Under **Organization settings → Auto Routing**, choose up to 30 models from the
[catalogue](https://llmgateway.io/models) that `auto` may resolve to, and the
classifier that ranks them. A project can override the organization default on
its own **Settings → Routing** page.

| Classifier         | Behavior                                                           |
| ------------------ | ------------------------------------------------------------------ |
| **None**           | Pick the cheapest model on your list that can serve the request    |
| **Jev (TypeSafe)** | Rate the request first, then serve it from the matching price band |

With Jev, your models are sorted by blended average price and split into Low,
Medium and High bands — the dashboard shows exactly which model lands in which
band. Each request is classified for difficulty, task type and output type, and
served from the matching band. A request rated High also gets a larger default
reasoning budget when the selected model supports reasoning and the request
left room for it.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Prove this queue is linearizable."}]
  }'
```

## Your list is the boundary

If nothing on your list can serve a request — an image request against a
text-only list, say — the gateway returns a `400` instead of falling back to a
model you did not allow. `free_models_only` narrows your list to its free
models rather than replacing it, so a request parameter cannot route outside
what your organization approved.

The classifier fails open. A timeout, an outage, or a compliance policy that
blocks its provider all fall back to the cheapest eligible model on your list,
and the log records that it did.

## One verdict per conversation

A request carrying a session id is classified once. The rest of the
conversation reuses that verdict and the model it resolved to, so a multi-turn
chat is not re-rated on every turn and does not migrate between models
mid-thread — which would cost it the upstream prompt cache.

## Dynamic routes can branch on it too

[Dynamic routes](https://docs.llmgateway.io/features/dynamic-routes) gain a
`classifier` node that rates the request and follows the matching case:

```json
{
  "id": "rate",
  "type": "classifier",
  "kind": "jev",
  "on": "difficulty",
  "cases": [
    { "value": "high", "next": "frontier" },
    { "value": "low", "next": "cheap" }
  ],
  "else": "balanced"
}
```

Only graphs that contain a classifier node pay for the call, and `else` covers
both an unmatched answer and no verdict at all.

Every routed request records why it landed where it did — the classifier used,
the candidates it chose between, the difficulty, task and output type, the band
served and the selected model — on the request's log entry, visible in the
activity detail view. That metadata is cleared with the rest of the request
payload when your data retention window elapses.

Configurable auto routing is available on the **Enterprise plan**. Organization
owners and admins set the default; project admins can override it per project.

---

**[Auto routing docs →](https://docs.llmgateway.io/features/routing)** | **[Configure auto routing →](https://llmgateway.io/dashboard)**
