---
id: "blog-track-llm-usage-spend-api"
slug: "track-llm-usage-spend-api"
date: "2026-07-26"
title: "How to Track LLM Usage and Spend with the API"
summary: "An LLM cost tracking tutorial: read the exact USD cost of every request from the response's usage object, segment spend by user and feature with metadata headers, enforce hard budgets with per-key spending limits, and audit everything in the dashboard."
categories: ["Guides"]
faqs:
  - question: "Does cost tracking work with streaming?"
    answer: "Yes. The final usage chunk of a streamed response includes `cost` and `cost_details`, identical to non-streaming responses."
  - question: "Does this work if I bring my own provider keys?"
    answer: "Yes. Requests routed through your own provider keys are logged and costed the same way — the dashboard splits spend between credits and BYOK traffic."
  - question: "Can I track image, video, and audio costs too?"
    answer: "Yes. The usage schema includes image input/output, audio, and video cost fields, and the dashboards break modality costs out — see the guides on [image](/blog/generate-images-api), [video](/blog/generate-videos-api), and [audio](/blog/generate-audio-api) generation."
  - question: "Is cost tracking gated to a paid plan?"
    answer: "No. Cost breakdown in API responses is available to all users, on both hosted and self-hosted deployments."
image:
  src: "/blog/track-llm-usage-spend-api.png"
  alt: "A glowing cost meter and coins on a circuit board, representing LLM usage and spend tracking"
  width: 1536
  height: 1024
---

Most teams discover their LLM spend the same way: on the invoice. Provider dashboards lag, tokens don't map cleanly to dollars, and once several models and providers are involved, nobody can answer "what did feature X cost last week?"

**LLM Gateway** makes LLM cost tracking a property of every request. Each API response carries its exact USD cost, every request is logged with full detail, and budgets are enforced at the key level — so spend is something you read in code, not reconstruct at month-end.

## Read the cost from every response

Every chat completion includes a `usage` object with real-time cost data:

```json
{
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25,
    "cost": 0.000125,
    "cost_details": {
      "input_cost": 0.000025,
      "output_cost": 0.0001,
      "cached_input_cost": 0,
      "request_cost": 0,
      "web_search_cost": 0,
      "data_storage_cost": 0.00000025
    }
  }
}
```

`cost` is the total inference cost in USD; `cost_details` splits it into input, output, cached-input, per-request, web-search, and storage components. Track it inline:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_GATEWAY_API_KEY,
  baseURL: "https://api.llmgateway.io/v1",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});

const usage = response.usage as { cost?: number };
console.log(`Request cost: $${usage.cost?.toFixed(6)}`);
```

Streaming responses include the same fields in the final usage chunk before `[DONE]`, so streamed traffic is just as accountable. The [cost breakdown docs](https://docs.llmgateway.io/features/cost-breakdown) document every field, including cache-write premiums and image and audio cost components.

## Enforce a budget in code

Because cost arrives with the response, budget enforcement is a few lines:

```typescript
let totalSpent = 0;
const BUDGET_LIMIT = 10.0; // $10

async function makeRequest(messages: Message[]) {
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages,
  });

  totalSpent += (response.usage as { cost?: number }).cost ?? 0;
  if (totalSpent > BUDGET_LIMIT) {
    throw new Error(`Budget exceeded: $${totalSpent.toFixed(2)}`);
  }
  return response;
}
```

<BlogCta variant="gateway" location="mid_article" />

## Segment spend by user, tenant, or feature

Attach metadata to any request with `X-LLMGateway-*` headers:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-LLMGateway-Tenant-ID: acme-corp" \
  -H "X-LLMGateway-User-ID: user-12345" \
  -H "X-LLMGateway-Feature: chat-assistant" \
  -d '{ "model": "gpt-4o", "messages": [{ "role": "user", "content": "Hi" }] }'
```

Requests are logged with their metadata, and the Activity view can filter by any custom header value — which turns "what did the chat-assistant feature cost?" into a filter instead of a data-engineering ticket. See the [metadata docs](https://docs.llmgateway.io/features/metadata).

## Put hard caps where the risk is

Per-request tracking tells you what happened; per-key limits stop what shouldn't. Each API key supports two independent [spending limits](https://docs.llmgateway.io/learn/api-keys):

- **All-time limit** — a lifetime cap for the key
- **Recurring limit** — like `$10/day` or `$500/month`, resetting automatically

When a key hits either limit, requests return `401` until the limit resets or is raised. Give every service, agent, and environment its own key and a runaway loop becomes a bounded incident, not an invoice.

## Audit it all in the dashboard

Everything above also lands in the dashboard, per project and per organization:

- [**Activity**](https://docs.llmgateway.io/learn/activity) — every request with tokens, cost, latency, finish reason, and provider
- [**Usage & Metrics**](https://docs.llmgateway.io/learn/usage-metrics) — requests, errors, cache hit rates, and cost trends over time
- [**Analytics**](https://docs.llmgateway.io/learn/analytics) — cost, requests, and tokens broken down by model
- [**Organization Analytics**](https://docs.llmgateway.io/learn/org-analytics) and [**Member Analytics**](https://docs.llmgateway.io/learn/member-analytics) — roll-ups across projects and per team member

Costs are split between credits and bring-your-own provider keys, and image, video, and audio generations carry their own cost components — so multimodal workloads stay as accountable as text.

---

**Get started:**

- **[Try LLM Gateway free](https://llmgateway.io/signup)** — cost visibility on your first request
- **[Cost breakdown docs](https://docs.llmgateway.io/features/cost-breakdown)** — the full usage schema
- **[Enterprise LLM analytics](/blog/enterprise-llm-analytics)** — org-wide reporting at scale

<BlogCta variant="gateway" location="bottom" />
