---
id: "114"
slug: "openai-compatible-decisions-api"
date: "2026-10-12"
title: "OpenAI-Compatible Decisions API"
summary: "The new /v1/decisions endpoint follows OpenAI's Decisions API and serves every decision model through one request shape. GPT-6 Luna Decisions launches there with image input at $0.10 per million input tokens, Microsoft-Decision-1 joins via Azure at $0.042, Jev moves over at the same price, and /v1/systemone will be deprecated soon."
tags: ["llmgateway"]
image:
  src: "/changelog/openai-compatible-decisions-api.png"
  alt: "A glowing branching switch on a central circuit-board chip with three weighted paths and a photo frame icon, representing typed decisions over text and images on LLM Gateway"
  width: 1536
  height: 1024
---

Typed decisions shipped on `/v1/systemone`, which speaks TypeSafe's request format. Now that OpenAI has its own Decisions API, a second wire format per provider would mean rewriting your integration every time you switch models. **`/v1/decisions`** is a new OpenAI-compatible endpoint that serves every decision model with one request shape, and the OpenAI SDKs work against it by changing the base URL.

## GPT-6 Luna Decisions, with image input

`gpt-6-luna-decisions` is GPT-6 Luna served through OpenAI's Decisions API. It reads text or images and answers `predicate`, `choice` and `score` questions with calibrated probabilities.

| Model                  | Provider | Input        | Price (input only)                         |
| ---------------------- | -------- | ------------ | ------------------------------------------ |
| `gpt-6-luna-decisions` | OpenAI   | Text, images | $0.10 / 1M tokens ($0.20 above 272K input) |
| `microsoft-decision-1` | Azure    | Text         | $0.042 / 1M tokens                         |
| `jev-1.13.0`           | TypeSafe | Text         | $0.042 / 1M tokens                         |

Output, cache reads and cache writes are free on all three — the response is a set of values, not generated text. `gpt-6-luna-decisions` has a 1.05M-token context and is in **beta**, matching OpenAI's public beta of the API.

```bash
curl -X POST "https://api.llmgateway.io/v1/decisions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-luna-decisions",
    "input": "I was charged twice for my order.",
    "questions": [
      {
        "type": "choice",
        "name": "department",
        "instructions": "Which department should handle this complaint?",
        "choices": [
          { "value": "billing", "description": "Payments, invoices, refunds" },
          { "value": "technical", "description": "Problems using the product" }
        ]
      },
      {
        "type": "predicate",
        "name": "is_urgent",
        "instructions": "Does this convey urgency?"
      }
    ]
  }'
```

Answers come back as an array in question order, each echoing its `name`. A question the model declines returns `refusal` while the rest are still answered. To evaluate an image, send a user message with `input_text` and `input_image` parts.

## Microsoft-Decision-1 on Azure

`microsoft-decision-1` is Microsoft's small decision model for classification, routing, ranking and grading, with a 32K-token context. Call it as `microsoft-decision-1` with LLM Gateway credits, or bring your own Azure key: deploy it in Microsoft Foundry under the deployment name `Decision-1` and add your Azure key and resource. It takes text only.

## Jev on the same endpoint

`jev-1.13.0` works on `/v1/decisions` too, at the same price. The gateway translates the request to TypeSafe's format and the answers back, so switching between Jev, Microsoft-Decision-1 and GPT-6 Luna Decisions is a one-field change. Jev is text-only: image parts are rejected with a `400`.

## /v1/systemone will be deprecated soon

`/v1/systemone` keeps working for existing integrations, but it now serves TypeSafe models only and gets no new models. Requesting `gpt-6-luna-decisions` or `microsoft-decision-1` there returns a `400` pointing at `/v1/decisions`. We will announce a deprecation date separately; the [migration guide](https://docs.llmgateway.io/features/decisions#migrating-from-v1systemone) maps every field.

Both endpoints run the same machinery as the rest of the gateway: IAM rules, compliance policies, credit gating, provider key rotation, request logging with a per-model cost breakdown, and a per-organization limit of 600 requests per minute.

---

**[Decisions docs →](https://docs.llmgateway.io/features/decisions)** | **[Browse decision models →](https://llmgateway.io/models?filters=1)**
