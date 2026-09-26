---
id: "blog-llm-decision-api"
slug: "llm-decision-api"
date: "2026-09-20"
title: "An LLM Decision API That Returns Values, Not Text"
summary: "Most classification and routing calls use a chat model, then parse prose and hope the JSON holds. The new /v1/systemone LLM decision API on LLM Gateway returns typed yes/no, choice, and score answers with calibrated probabilities, billed on input tokens only."
categories: ["Announcements", "Product"]
faqs:
  - question: "What is an LLM decision API?"
    answer: "An endpoint for models that return a typed value rather than generated text. You send a state and named questions; each answer comes back as a probability, a chosen option, or a score, with a probability distribution and a confidence figure you can threshold on in code."
  - question: "How is /v1/systemone different from JSON mode on a chat model?"
    answer: "JSON mode still generates text that happens to parse. A decision model emits values directly, so there is no schema drift, no preamble to strip, and no retry loop. It also returns a probability per option, which a chat model cannot give you honestly."
  - question: "What does a decision model cost?"
    answer: "Jev 1.13 is $0.042 per million input tokens with output free, because the response is a set of values rather than generated text. The state and every question count as input on each call."
  - question: "Can I use a decision model on /v1/chat/completions?"
    answer: "No. Decision models only work on /v1/systemone. Requesting one on chat completions returns a 400 pointing at the right endpoint. They cannot generate text or call tools, and they are not available in the Playground."
image:
  src: "/blog/llm-decision-api.png"
  alt: "A glowing decision switch on a central chip with light traces branching into three weighted paths, surrounded by probability dials and a routing signpost"
  width: 1536
  height: 1024
---

A lot of production LLM traffic is not generation at all. It is a model being
asked a question with a small, known answer set: which team owns this ticket,
is this passage relevant to the query, does this citation support the claim, is
this record a duplicate. The answer is one of three options, or a number
between zero and one — and yet the call goes to a chat model, which writes a
sentence about it.

That costs more than it looks. You write prompt scaffolding to force JSON, you
parse and validate the result, you retry when the model prefixes it with
"Sure!", and you pay for every output token spent saying something your code
immediately throws away. Worst of all, you get a verdict with no uncertainty
attached: the model says `billing` with exactly as much apparent conviction
when it is sure as when it is guessing.

**LLM Gateway** now has a dedicated **LLM decision API** for this shape of
work. `POST /v1/systemone` serves **System One** models: models that read a
state, answer questions you name, and return typed values with calibrated
probabilities. There is no free-form text in the response.

## Three question types

A request has a `state` — the thing being evaluated — and a map of questions
keyed by ids you choose. Answers come back under the same ids.

| Type     | Ask                              | Answer                                                    |
| -------- | -------------------------------- | --------------------------------------------------------- |
| `noul`   | A yes/no question                | `noul`: probability the answer is yes, 0 to 1             |
| `choice` | One option from a set you define | `choice`, `probabilities` per option, `confidence`        |
| `score`  | A rating across ordered levels   | `score` (can land between levels), `legend`, `confidence` |

Choice questions take two to 255 options, each with an optional rubric. Score
questions take two to ten ordered levels, lowest first. Both `state` and each
`instructions` field accept structured data as well as plain text, so a
question can refer to fields of the record you passed in.

```bash
curl -X POST "https://api.llmgateway.io/v1/systemone" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-1.13.0",
    "state": "Help! My payouts have been failing for 3 days.",
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

```json
{
  "model": "typesafe/jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 },
      "confidence": 0.81
    },
    "is_urgent": { "type": "noul", "noul": 0.95 },
    "impact": {
      "type": "score",
      "score": 1.9,
      "legend": { "0": "None", "1": "Limited", "2": "Critical" },
      "probabilities": { "0": 0.0, "1": 0.1, "2": 0.9 },
      "confidence": 0.88
    }
  },
  "usage": { "input_tokens": 318, "output_tokens": 34 }
}
```

## The policy stays in your code

The reason a probability matters more than a label is that the cutoff is a
product decision, not a model decision. A support router and a fraud hold want
very different thresholds on the same question, and neither wants to renegotiate
it by editing a prompt.

With typed answers, the threshold is an `if`. `confidence` gives you a second
axis: it is derived from the probability distribution, so you can send an
uncertain case to a human instead of acting on what is effectively a coin flip.

```ts
const { answers } = await res.json();

if (answers.department.confidence < 0.7) {
  await queueForTriage(ticket);
} else {
  await route(ticket, answers.department.choice, {
    priority: answers.is_urgent.noul > 0.8 ? "high" : "normal",
  });
}
```

Because the answer set is fixed by the request, there is no schema drift to
guard against. `answers.department.choice` is one of the keys you sent, every
time.

## Ask everything at once

The state is read once and every question is evaluated against it, so a batch
of questions costs far less than one request each. That changes what is worth
asking. Speculative questions — ones you only read when another answer makes
them relevant — become close to free, so you can resolve a whole decision tree
in a single round trip instead of chaining calls.

The trade-off is that question text counts as input on every call. A large
rubric attached to every request has a real per-request cost, so keep criteria
tight and push detail into the state where it belongs.

## Jev 1.13, billed on input only

The first decision model on the gateway is `typesafe/jev-1.13.0` from TypeSafe
AI, at **$0.042 per million input tokens with output free** — the response is a
set of values, not generated text. Moving aliases such as `jev-latest` are
accepted and resolve to the pinned version, so a request is always billed and
logged against a version whose price you can look up.

The endpoint runs the same machinery as every other route on the gateway: API
key auth, IAM rules, compliance policies, credit gating, provider key rotation,
cancellation, and request logging with a per-model cost breakdown. The rate
limit is 600 requests per minute per organization, and decision requests share
the same fleet-wide concurrency budget as every other inference endpoint. See
the [rate limits reference](https://docs.llmgateway.io/resources/rate-limits)
for the full table.

A few constraints are worth knowing before you build on it:

- Decision models only work on `/v1/systemone`. Requesting one on
  `/v1/chat/completions` returns a `400` pointing at the right endpoint.
- They cannot generate text or call tools, and they are not in the Playground.
- Input is text only. There is no streaming — the response is a single object.

## When a decision model is the wrong tool

This is not a replacement for a chat model that happens to classify. If the
answer set is open-ended, if you need the model to explain its reasoning to a
human, or if the classification is one step inside a longer generative task,
stay on `/v1/chat/completions` — and if you want structured output there,
[structured outputs](https://docs.llmgateway.io/learn/structured-outputs) is still
the right mechanism.

Reach for a decision model when the call exists only to produce a value your
code branches on, when you want a probability rather than an assertion, and
when you are making enough of these calls that paying for output tokens on
throwaway prose adds up.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[System One docs](https://docs.llmgateway.io/features/system-one)**
- **[Browse decision models](https://llmgateway.io/models?filters=1)**
