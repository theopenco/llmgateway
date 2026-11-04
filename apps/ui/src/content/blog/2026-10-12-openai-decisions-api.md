---
id: "blog-openai-decisions-api"
slug: "openai-decisions-api"
date: "2026-10-12"
title: "OpenAI Decisions API on LLM Gateway: GPT-6 Luna, Microsoft-Decision-1 and Jev"
summary: "LLM Gateway now serves the OpenAI Decisions API at /v1/decisions. GPT-6 Luna Decisions answers typed questions about text and images at $0.10 per million input tokens, Microsoft-Decision-1 on Azure and Jev run on the same request shape, and the OpenAI SDKs work with a base URL change."
categories: ["Announcements", "Product"]
model: "gpt-6-luna-decisions"
faqs:
  - question: "What is the OpenAI Decisions API?"
    answer: "An OpenAI endpoint, POST /v1/decisions, that evaluates text or images against typed questions and returns values instead of generated text: a probability for a predicate, a chosen option with a probability per option, or a score across ordered levels. gpt-6-luna is the model behind it, and it is in public beta."
  - question: "How do I use the OpenAI Decisions API through LLM Gateway?"
    answer: "Send the same request body to https://api.llmgateway.io/v1/decisions with your LLM Gateway API key and model gpt-6-luna-decisions, or point the OpenAI SDK's baseURL at https://api.llmgateway.io/v1 and call decisions.create."
  - question: "What does GPT-6 Luna Decisions cost?"
    answer: "$0.10 per million input tokens, or $0.20 per million when a request has more than 272K input tokens. There are no output, cache-read or cache-write charges."
  - question: "Which decision models can I use on /v1/decisions?"
    answer: "gpt-6-luna-decisions from OpenAI ($0.10 per million input tokens, text and images), microsoft-decision-1 served by Azure ($0.042 per million input tokens, text) and jev-1.13.0 from TypeSafe ($0.042 per million input tokens, text). All three use the same request and response shape."
  - question: "What happens to /v1/systemone?"
    answer: "It keeps working for existing integrations but serves TypeSafe models only and will be deprecated soon. Jev is available on /v1/decisions at the same price, and new decision models ship on /v1/decisions only."
image:
  src: "/blog/openai-decisions-api.png"
  alt: "A glowing branching switch on a central chip with weighted light paths, a photo frame and probability dials around it, representing the OpenAI Decisions API on LLM Gateway"
  width: 1536
  height: 1024
---

Three weeks ago we shipped [an LLM decision API](/blog/llm-decision-api) for calls that exist only to produce a value: route this ticket, score this passage, flag this record. It spoke TypeSafe's request format, because Jev was the only decision model around. Since then OpenAI released its own **Decisions API** with GPT-6 Luna behind it — and a different wire format.

Two providers with two shapes for the same job is exactly what a gateway is supposed to hide. **LLM Gateway** now serves the **OpenAI Decisions API** at `/v1/decisions`, with GPT-6 Luna Decisions, Microsoft-Decision-1 and Jev behind the same request shape. Switching models is a one-field change, and the OpenAI SDKs work by changing the base URL.

## What the OpenAI Decisions API does

A request has three parts: a `model`, an `input` — a string, or user messages with text and image parts — and a list of `questions`. Each question has a type:

| Type        | Ask                                   | Answer                                                         |
| ----------- | ------------------------------------- | -------------------------------------------------------------- |
| `predicate` | Whether a condition is true           | `probability`, 0 to 1                                          |
| `choice`    | One option from the `choices` you set | `choice`, a probability per option, `confidence`               |
| `score`     | A rating across ordered `levels`      | `score` (can land between levels), probabilities, `confidence` |

Answers come back in the order you asked, each echoing the question's `name`. If the model declines one question it returns `refusal` for that one and still answers the rest, so a single bad question does not fail the batch.

```bash
curl -X POST "https://api.llmgateway.io/v1/decisions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-luna-decisions",
    "input": "Export fails in Safari but works in Chrome.",
    "questions": [
      {
        "type": "score",
        "name": "severity",
        "instructions": "How severe is this issue?",
        "levels": [
          { "label": "Cosmetic", "description": "Appearance only." },
          { "label": "Workaround available", "description": "Another way works." },
          { "label": "Fully blocked", "description": "No workaround." }
        ]
      }
    ]
  }'
```

```json
{
  "model": "openai/gpt-6-luna-decisions",
  "answers": [
    {
      "type": "score",
      "name": "severity",
      "score": 1.1,
      "probabilities": [
        { "value": 0, "label": "Cosmetic", "probability": 0.1 },
        { "value": 1, "label": "Workaround available", "probability": 0.7 },
        { "value": 2, "label": "Fully blocked", "probability": 0.2 }
      ],
      "confidence": 0.55
    }
  ],
  "usage": { "input_tokens": 96, "output_tokens": 0, "total_tokens": 96 }
}
```

## GPT-6 Luna Decisions: images and a 1M context

`gpt-6-luna-decisions` is GPT-6 Luna served through OpenAI's Decisions API. Two things set it apart from Jev:

- **Image input.** Put `input_text` and `input_image` parts in a user message to check a product photo for damage, classify a screenshot, or verify that an uploaded document is the one you asked for.
- **A 1.05M-token context.** Long records, full support threads and large documents fit in one request.

It is billed on input only: **$0.10 per million input tokens**, or $0.20 per million when a request has more than 272K input tokens. Output, cache reads and cache writes are free. The model is in beta on LLM Gateway, matching OpenAI's public beta.

## Use the OpenAI SDK unchanged

Because `/v1/decisions` follows OpenAI's shape, the official SDKs work as they are — `decisions.create` needs OpenAI's JavaScript SDK 7.30.0 or later (Python 3.26.0 or later). Point the client at LLM Gateway:

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const decision = await client.decisions.create({
  model: "gpt-6-luna-decisions",
  input: ticket,
  questions: [
    {
      type: "choice",
      name: "department",
      instructions: "Which department should handle this?",
      choices: [
        { value: "billing" },
        { value: "technical" },
        { value: "other" },
      ],
    },
  ],
});
```

You get the same request logging, per-model cost breakdown, IAM rules, compliance policies and provider key rotation as on every other gateway endpoint, and you can bring your own OpenAI key or pay with gateway credits.

## Microsoft-Decision-1 and Jev on the same request shape

`jev-1.13.0` from TypeSafe AI is available on `/v1/decisions` too, still at $0.042 per million input tokens. The gateway translates the request into TypeSafe's format and the answers back into OpenAI's, so the code above runs against Jev by changing `model`. Jev is text-only, so image parts are rejected with a `400` instead of being silently dropped.

`microsoft-decision-1` is Microsoft's small decision model for classification, routing, ranking and grading, also at $0.042 per million input tokens with a 32K-token context. It is served by Azure: call `microsoft-decision-1` with LLM Gateway credits, or bring your own Azure key by deploying it in Microsoft Foundry under the deployment name `Decision-1` and adding the key and resource to LLM Gateway. Like Jev, it takes text only and is translated from the same request shape.

That makes the choice a cost, capability and hosting question rather than an integration project: Jev or Microsoft-Decision-1 for high-volume text classification at the lowest price — Microsoft-Decision-1 when you already run your models on Azure — and GPT-6 Luna Decisions when you need images or very long input.

## /v1/systemone will be deprecated soon

`/v1/systemone` keeps working, so nothing breaks today. It now serves TypeSafe models only, new decision models ship on `/v1/decisions` only, and we will deprecate it once there has been time to migrate. The [migration guide](https://docs.llmgateway.io/features/decisions#migrating-from-v1systemone) maps each field:

- `state` becomes `input`; structured state is serialized to a string.
- The `questions` map becomes an array, and each key moves to `name`.
- `noul` becomes `predicate`, choice `criteria` become `choices`, and score `criteria` become `levels`.
- Answers become an array in question order, and probabilities become arrays of `{ value, probability }`.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Decisions docs](https://docs.llmgateway.io/features/decisions)**
- **[An LLM decision API that returns values, not text](/blog/llm-decision-api)**
