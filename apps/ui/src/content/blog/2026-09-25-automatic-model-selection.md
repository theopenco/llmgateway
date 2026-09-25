---
id: "blog-automatic-model-selection"
slug: "automatic-model-selection"
date: "2026-09-25"
title: "Automatic Model Selection by Request Difficulty"
summary: "Automatic model selection now reads the request before it routes it. Choose the models `auto` may resolve to, and a classifier rates each prompt so a one-line fix goes to a cheap model and a hard problem goes to a frontier one. Available on the Enterprise plan."
categories: ["Announcements", "Product"]
faqs:
  - question: "How does automatic model selection decide which model to use?"
    answer: "You choose up to 30 models that the auto model may resolve to. LLM Gateway sorts them by blended average price and splits them into Low, Medium and High bands. A classifier rates each request for difficulty, task type and output type, and the request is served from the matching band. Without a classifier, the cheapest model on your list that can serve the request wins."
  - question: "What happens if the classifier is unavailable?"
    answer: "It fails open. A timeout, an upstream outage, a missing credential, or a compliance policy that blocks the classifier's provider all fall back to the cheapest eligible model on your list. The request still succeeds, and the log records that the classifier did not produce a verdict."
  - question: "Does the classifier run on every turn of a conversation?"
    answer: "No. A request carrying a session id is classified once, and the rest of the conversation reuses that verdict and the model it resolved to. That avoids paying for a classifier call per turn and keeps the conversation on one model, so it does not lose the upstream prompt cache mid-thread."
  - question: "Can a request escape the models I configured?"
    answer: "No. The configured list is a boundary, not a preference. If nothing on it can serve a request, the gateway returns a 400 rather than falling back to a model you did not approve, and free_models_only narrows your list to its free models instead of replacing it."
image:
  src: "/blog/automatic-model-selection.png"
  alt: "Glossy circuit board with a glowing signpost on a central chip, traces splitting into three lit paths surrounded by scale, code and coin icons representing automatic model selection"
  width: 1536
  height: 1024
---

Most production traffic is not uniform. The same endpoint gets "reword this
paragraph" and "find the race condition in this scheduler" within a second of
each other, and both are billed at whatever model you hardcoded. Pin a frontier
model and you overpay for the easy half. Pin a cheap one and the hard half
comes back wrong.

The usual workaround is to classify requests in your own application code and
pick a model per branch — which means maintaining a prompt, a model list, and a
fallback path that all drift from the catalogue. **LLM Gateway** now does
**automatic model selection** for you, and reads the request before deciding.

## Choose the models, choose the classifier

Sending `"model": "auto"` has always picked the cheapest model that fits the
request. What is new is that you control the candidate list and how it is
ranked. Under **Organization settings → Auto Routing**, pick up to 30 models
from the [catalogue](https://llmgateway.io/models) and a classifier. A project
can override the organization default on its own routing settings page.

| Classifier         | Behavior                                                           |
| ------------------ | ------------------------------------------------------------------ |
| **None**           | Pick the cheapest model on your list that can serve the request    |
| **Jev (TypeSafe)** | Rate the request first, then serve it from the matching price band |

With the Jev classifier, your models are sorted by blended average price and
split into Low, Medium and High bands — the dashboard shows which model lands
in which band before you save. Each request is then rated for difficulty, task
type and output type and served from the matching band.

```bash
curl https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Prove this queue is linearizable."}]
  }'
```

Nothing about your request changes. The same call that used to resolve to a
fixed cheap model now resolves to whichever of your models the request actually
warrants.

## Your list is a boundary, not a preference

This is the part worth being precise about, because it is what makes the
feature safe to turn on for a whole organization.

If no model on your list can serve a request — an image request against a
text-only list, say — the gateway returns a `400`. It does not quietly fall
back to a model you did not approve. `free_models_only` narrows your list to
its free models rather than replacing it, so a request parameter cannot route
outside what you configured.

The classifier itself fails open in the other direction. A timeout, an outage,
a missing credential, or a compliance policy that blocks the classifier's
provider all fall back to the cheapest eligible model on your list. A
classifier problem slows a request down; it never fails one.

## One verdict per conversation

Rating every turn of a long chat would be both wasteful and wrong. Wasteful
because you pay for a classifier call per turn; wrong because a conversation
that hops between models loses the upstream prompt cache it had been building.

So a request carrying a session id is classified once. The rest of the
conversation reuses that verdict and the model it resolved to, for the duration
of the [sticky session](https://docs.llmgateway.io/features/routing#sticky-session-routing).
Driving a coding agent through the gateway, a full multi-turn task makes
exactly one classifier call.

## Branch on the verdict in a dynamic route

If you want the routing logic explicit rather than implicit,
[dynamic routes](https://docs.llmgateway.io/features/dynamic-routes) gain a
`classifier` node that branches on the same verdict:

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

`on` also accepts `task` and `outputType`, so you can send coding traffic one
way and summarization another. Only graphs containing a classifier node pay for
the call, and `else` covers both an unmatched answer and no verdict at all —
give it a real model rather than a reject branch.

## Every decision is on the log

Routing you cannot audit is routing you cannot trust. Each request records the
classifier used, the candidates it chose between, the difficulty, task and
output type, the band served, the selected model, and whether the verdict was
reused from earlier in the session. It is all on the request's entry in the
activity view, and it is cleared along with the rest of the request payload
when your data retention window elapses.

## Getting started

1. On the **Enterprise plan**, open **Organization settings → Auto Routing**.
2. Pick the models `auto` may resolve to and check the band preview.
3. Choose a classifier, save, and send `"model": "auto"`.
4. Override it per project from that project's routing settings if a workload
   needs a different list.

Owners and organization admins set the default; project admins can override it.
If you are weighing this against routing by hand, the arithmetic in
[cutting LLM costs with request routing](/blog/cut-llm-costs-with-request-routing)
still applies — this is the same idea, with the classification and the fallback
handled for you.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Auto routing documentation](https://docs.llmgateway.io/features/routing)**
- **[Cut LLM costs with request routing](/blog/cut-llm-costs-with-request-routing)**
