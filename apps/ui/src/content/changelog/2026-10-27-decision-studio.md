---
id: "117"
slug: "decision-studio"
date: "2026-10-27"
title: "Decision Studio in Lounge"
summary: "Lounge gets a Decision Studio: paste any text or image, build yes/no, pick-one and rating questions in the browser, and run them on GPT-6 Luna Decisions, Microsoft-Decision-1 or Jev. Answers come back as probabilities you can read at a glance, compare across models, and copy as a ready-to-send /v1/decisions request."
tags: ["lounge"]
image:
  src: "/changelog/decision-studio.png"
  alt: "The Lounge Decision Studio showing a support ticket evaluated by Jev with a chosen department, a 98% urgency probability and a churn-risk rating, each with probability bars"
  width: 1536
  height: 1024
---

Trying a decision model has meant writing a request by hand: a JSON body with typed questions, a curl call, and a response you read as raw numbers. There was no place to paste a ticket, ask three questions and see whether the model agrees with you before wiring it into code. **Decision Studio** is that place: a new studio in Lounge at [lounge.llmgateway.io/decisions](https://lounge.llmgateway.io/decisions) that runs any decision model on your own text or images and shows every answer as a probability.

## Build the questions in the browser

Paste the input, then add up to 10 questions of three kinds:

| Type         | You define                               | Answer                                      |
| ------------ | ---------------------------------------- | ------------------------------------------- |
| **Yes / no** | Instructions                             | Probability the condition holds             |
| **Pick one** | 2 to 12 options, each with a description | The chosen option and a probability per one |
| **Rate**     | 2 to 10 ordered levels                   | The most likely level and a weighted score  |

Those counts are the studio's limits; the API accepts up to 255 options per question.

Each question takes an optional name such as `is_urgent` that is echoed back in the answer, which is what your code would branch on. Six presets cover support triage, moderation, lead qualification, review classification, request routing and application screening, so the first run is one click.

## Read the answer, not the JSON

Every answer renders as a card: the winning value in bold, a bar per option or level with its probability, and the model's confidence. A declined question shows as refused while the others are still answered. Turn on comparison mode to run the same input and questions on up to three decision models side by side.

Models with image input, such as `gpt-6-luna-decisions`, accept up to 4 pasted, dropped or picked images alongside the text, or on their own. Images are resized to 1536px in the browser before they are sent.

## Copy the run as an API request

Every result has a **cURL** button that copies the run as the `/v1/decisions` request (attached images become a placeholder data URL), and a **JSON** toggle that shows the raw answers as the API returns them:

```bash
curl -X POST "https://api.llmgateway.io/v1/decisions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-1.14.0",
    "input": "Hi, I was charged twice for my order and still have no refund.",
    "questions": [
      {
        "type": "choice",
        "name": "department",
        "instructions": "Which team should handle this ticket?",
        "choices": [{ "value": "billing" }, { "value": "technical" }]
      },
      {
        "type": "predicate",
        "name": "is_urgent",
        "instructions": "Does the customer convey urgency or a deadline?"
      }
    ]
  }'
```

Runs are saved to your decision history with their input, questions and answers. Opening one loads it back into the editor so you can change a question or try another model, and each saved run earns Lounge points like the other studios.

Decision models are billed on input tokens only, at the model's catalogue price: `gpt-6-luna-decisions` at $0.10 per million, `microsoft-decision-1` and `jev-1.14.0` at $0.042 per million. The studio draws on the same credit balance or membership allowance as chat.

---

**[Decision Studio docs →](https://docs.llmgateway.io/learn/playground-decisions)** | **[Open Decision Studio →](https://lounge.llmgateway.io/decisions)**
