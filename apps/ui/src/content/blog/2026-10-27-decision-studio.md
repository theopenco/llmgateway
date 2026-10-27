---
id: "blog-decision-studio"
slug: "decision-studio"
date: "2026-10-27"
title: "Decision Studio: Try Decision Models Without Writing a Request"
summary: "Decision models return probabilities instead of prose, but trying one meant hand-writing JSON. Lounge's new Decision Studio lets you paste a ticket, build yes/no, pick-one and rating questions in the browser, compare GPT-6 Luna Decisions, Microsoft-Decision-1 and Jev on the same input, and copy the run as a /v1/decisions request."
categories: ["Announcements", "Product"]
faqs:
  - question: "What is the Decision Studio in Lounge?"
    answer: "A studio at lounge.llmgateway.io/decisions that runs decision models on text or images you paste in. You define yes/no, pick-one and rating questions and get back typed answers with probabilities, rendered as cards with a bar per option."
  - question: "Which decision models can I run in the Decision Studio?"
    answer: "Every decision model in the LLM Gateway catalogue: gpt-6-luna-decisions from OpenAI (text and images), microsoft-decision-1 served by Azure, and TypeSafe's jev-1.14.0 and jev-1.13.0. Comparison mode runs up to three of them on the same input."
  - question: "How much does a run in the Decision Studio cost?"
    answer: "The model's catalogue input price, billed on the input plus every question with no output charge: $0.10 per million input tokens for gpt-6-luna-decisions and $0.042 per million for microsoft-decision-1 and Jev. Runs draw on the same credits or Lounge membership allowance as chat."
  - question: "Can I turn a Decision Studio run into API code?"
    answer: "Yes. Every result has a cURL button that copies the run as the POST /v1/decisions request (attached images become a placeholder), and a JSON toggle that shows the raw answers as the API returns them."
image:
  src: "/blog/decision-studio.png"
  alt: "The Lounge Decision Studio with a support ticket evaluated by Jev: a chosen department, a 98% urgency probability and a churn-risk rating, each shown as probability bars"
  width: 1536
  height: 1024
---

A **decision model** answers questions you define with probabilities instead of generated text: 0.98 that a ticket is urgent, 0.88 that it belongs to billing, a churn risk that lands on "imminent". That is exactly what a routing or moderation step needs, and since October [LLM Gateway serves them on an OpenAI-compatible `/v1/decisions` endpoint](/blog/openai-decisions-api).

What was missing was a way to try one. Chat models have had a chat window since day one; a decision model had a JSON schema and a curl example. To see whether `microsoft-decision-1` agrees with your support team on a real ticket, you wrote the request by hand, read the probabilities out of the raw response, edited a question, and ran it again. **Decision Studio**, new in [Lounge](https://lounge.llmgateway.io/decisions), is the window for decision models.

## Build the questions in the browser

The studio has two parts: the input and the questions. Paste anything a decision model should judge, such as a support ticket, a comment, a lead, a review, a chat message, or a résumé, then add up to ten questions. Each has one of three types:

| Type         | Ask                            | You define                             | Answer                                     |
| ------------ | ------------------------------ | -------------------------------------- | ------------------------------------------ |
| **Yes / no** | Whether a condition is true    | Instructions                           | Probability that it holds                  |
| **Pick one** | One option from a set          | 2 to 12 options, descriptions optional | The chosen option and a probability each   |
| **Rate**     | A rating across ordered levels | 2 to 10 levels, lowest first           | The most likely level and a weighted score |

The option and level counts are the studio's limits, chosen to keep a question readable; the API accepts up to 255 options. Questions take an optional name like `is_urgent` or `department`. It is echoed back in the answer, so the names you settle on in the studio are the fields your code reads later. Blank names are filled in as `q1`, `q2` and so on. The studio validates as you type, with the same rules the gateway applies, so a blank option or a duplicate level disables the run instead of surfacing a 400.

Six presets load a realistic input and three questions in one click: triage a support ticket, moderate a comment, qualify a sales lead, classify a product review, route a chat message, screen a job application. Each mixes the question types so the first result shows what every answer shape looks like.

## Read probabilities, not JSON

Every answer renders as a card. The headline is the value a program would branch on: the chosen option, "98% yes", the most likely level. Under it is a bar per option or level with its probability, and the model's confidence where the API reports one. A question the model declines shows as refused while the others are still answered.

![The Lounge Decision Studio with a support ticket evaluated by Jev: a chosen department, a 98% urgency probability and a churn-risk rating, each shown as probability bars](/screenshots/decision-studio-dark.png)

Two buttons on every result bridge back to the API. **cURL** copies the run as the `POST /v1/decisions` request, model and questions included, ready to paste into a terminal or a codebase; attached images become a placeholder data URL in the snippet. **JSON** toggles the card view to the raw `answers` array as the gateway returned it.

```bash
curl -X POST "https://api.llmgateway.io/v1/decisions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-1.14.0",
    "input": "Hi, I was charged twice for my order #48213 and still have no refund. If this is not resolved today I am disputing the charge.",
    "questions": [
      {
        "type": "choice",
        "name": "department",
        "instructions": "Which team should handle this ticket?",
        "choices": [
          { "value": "billing", "description": "Payments, invoices, refunds" },
          { "value": "technical", "description": "Bugs, outages, integrations" }
        ]
      },
      {
        "type": "predicate",
        "name": "is_urgent",
        "instructions": "Does the customer convey urgency or a deadline?"
      },
      {
        "type": "score",
        "name": "churn_risk",
        "instructions": "How likely is this customer to leave?",
        "levels": [{ "label": "Low" }, { "label": "Medium" }, { "label": "High" }, { "label": "Imminent" }]
      }
    ]
  }'
```

## Compare decision models on one input

Decision models disagree more than you would expect, and the disagreements are the point: a cheap model that matches the expensive one on your data is a cost saving, and one that does not is a bug you found before production. Comparison mode runs the same input and questions on up to three models at once and lays the cards out side by side, so a 0.98 from Jev next to a 0.71 from Microsoft-Decision-1 is one glance, not two terminal windows.

Every decision model in the catalogue is available:

| Model                  | Provider | Input        | Price (input only) |
| ---------------------- | -------- | ------------ | ------------------ |
| `gpt-6-luna-decisions` | OpenAI   | Text, images | $0.10 / 1M tokens  |
| `microsoft-decision-1` | Azure    | Text         | $0.042 / 1M tokens |
| `jev-1.14.0`           | TypeSafe | Text         | $0.042 / 1M tokens |

Models with image input accept up to four pasted, dropped or picked images next to the text, or on their own, so "does this product photo show damage?" is a yes/no question like any other. Images are resized to 1536px in the browser before they are sent, and are offered only when every selected model can read them.

## Runs are saved, named and reusable

Each run lands in your decision history with its input, questions and answers. Opening a past run loads it back into the editor, so the loop is: change one question, pick another model, run again. Rename a run from its menu; the evaluated input itself never changes. Saved runs count toward [Lounge points](https://lounge.llmgateway.io/leaderboard) like images, videos and audio: 10 per run, up to 100 a day.

Billing is the model's catalogue price on input tokens, which means the input plus every question, with no output charge. The studio draws on the same credit balance or [Lounge membership](https://lounge.llmgateway.io/pricing) allowance as chat and the other studios.

## When to reach for a decision model

Use the studio to find out whether a decision model fits before you build on it:

- **Routing.** Which model tier, which team, which queue. A `choice` question with descriptions per option, thresholded on the probability.
- **Moderation and screening.** Does this violate policy, does this candidate meet the bar. A `predicate` you can threshold at 0.9 for auto-action and 0.5 for review.
- **Grading.** Sentiment, severity, seniority, quality. A `score` across the levels your team already uses.

A chat model can do all of these too, but you parse prose to get an answer and have no probability to threshold on. Decision models give you the number, and now you can see the number before you write a line of code.

- **[Open Decision Studio](https://lounge.llmgateway.io/decisions)**
- **[Decision Studio docs](https://docs.llmgateway.io/learn/playground-decisions)** and the **[Decisions API reference](https://docs.llmgateway.io/features/decisions)**
- **[OpenAI Decisions API on LLM Gateway](/blog/openai-decisions-api)**, the post that introduced `/v1/decisions`
