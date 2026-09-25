---
id: "99"
slug: "system-one-typed-decisions"
date: "2026-09-20"
title: "System One: Typed Decisions"
summary: "The new /v1/systemone endpoint returns typed decisions with calibrated probabilities instead of generated text. TypeSafe's Jev 1.13 is the first decision model, billed on input tokens only."
tags: ["llmgateway"]
image:
  src: "/changelog/system-one-typed-decisions.png"
  alt: "A glowing decision switch on a circuit-board chip surrounded by probability dials and branching paths, representing typed decisions on LLM Gateway"
  width: 1536
  height: 1024
---

Plenty of model calls exist only to make a decision: route this ticket, score
this passage, check whether this citation supports the claim. A chat model can
do it, but you then parse prose, hope the JSON holds, and get no number to
threshold on. **System One** is a new endpoint for models that skip the text
entirely — you name the questions, and every answer comes back as a value your
code can branch on, with a probability attached.

## One endpoint, three question types

`POST https://api.llmgateway.io/v1/systemone` takes a `state` and a map of
questions keyed by ids you choose. Answers come back under the same ids.

| Type     | Ask                              | Answer                                                    |
| -------- | -------------------------------- | --------------------------------------------------------- |
| `noul`   | A yes/no question                | `noul`: probability the answer is yes, 0 to 1             |
| `choice` | One option from a set you define | `choice`, `probabilities` per option, `confidence`        |
| `score`  | A rating across ordered levels   | `score` (can land between levels), `legend`, `confidence` |

```bash
curl -X POST "https://api.llmgateway.io/v1/systemone" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-1.13.0",
    "state": "Our production integration has been returning 500s for 3 days.",
    "questions": {
      "department": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": {
          "billing": "Payments, invoicing, refunds",
          "technical": "Bugs, outages, integrations",
          "sales": "Pricing, upgrades, new accounts"
        }
      },
      "is_urgent": {
        "type": "noul",
        "instructions": "Does this convey urgency?"
      },
      "impact": {
        "type": "score",
        "instructions": "Rate the operational impact.",
        "criteria": ["None", "Limited", "Critical"]
      }
    }
  }'
```

`state` and every `instructions` field accept structured data as well as plain
text, so a question can reference fields of the record you passed in. Choice
questions take up to 255 options; score questions take two to ten ordered
levels.

The policy stays in your code: threshold `noul` where you want the cutoff, and
use `confidence` as a second axis to send uncertain cases to a human instead of
acting on a coin flip.

## Jev 1.13, billed on input only

The first decision model is `typesafe/jev-1.13.0` from TypeSafe AI, at **$0.042
per million input tokens with output free** — the response is a set of values,
not generated text. Moving aliases such as `jev-latest` resolve to the pinned
version, so a request is always billed and logged against a version you can
read prices for.

Because the state is read once and every question is evaluated against it, a
batch of questions costs far less than one request each — including
speculative questions you only read when another answer makes them relevant.
Question text counts as input on every call, so a large rubric has a real
per-request cost.

Decision models only work on `/v1/systemone`. Asking for one on
`/v1/chat/completions` returns a `400` pointing at the right endpoint; they
cannot generate text or call tools, and they are not in the Playground. Input
is text only. The endpoint runs the same machinery as every other gateway
route: IAM rules, compliance policies, credit gating, provider key rotation,
request logging with a per-model cost breakdown, and a per-organization rate
limit of 600 requests per minute.

---

**[System One docs →](https://docs.llmgateway.io/features/system-one)** | **[Browse decision models →](https://llmgateway.io/models?filters=1)**
