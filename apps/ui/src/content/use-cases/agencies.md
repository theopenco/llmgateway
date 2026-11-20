---
id: use-case-agencies
slug: agencies
date: 2026-11-20
title: LLM gateway for agencies
metaTitle: "LLM Gateway for Agencies — Per-Client AI Cost Tracking"
description: "An LLM gateway for agencies: separate projects and API keys per client, usage limits, and per-request cost logs so AI spend can be attributed and billed back accurately."
headline: "Keep every client's AI usage separate, capped, and ready to bill back."
summary: "Per-client projects and API keys, usage limits, and cost logs across every model provider, through one OpenAI-compatible API."
benefits:
  - title: One project per client
    description: "Give each client its own project and API keys so usage, logs, and spend never mix."
  - title: Costs you can bill back
    description: "Every request is logged with model, tokens, and cost, grouped by API key, so client invoices are based on real usage."
  - title: Limits that stop overruns
    description: "Set a usage limit on an API key and requests stop when a client's budget is spent."
  - title: Any model the client asks for
    description: "One integration reaches every supported provider, so a client's model preference does not mean a new build."
faqs:
  - question: How do agencies track AI costs per client?
    answer: "Create a project and API key for each client. LLM Gateway logs every request with its model, token counts, and cost, and groups usage by key, which gives you a per-client total to bill back."
  - question: Can we cap what a client project spends?
    answer: "Yes. API keys can carry a usage limit. When the limit is reached, requests with that key are rejected until you raise it."
  - question: Can clients use their own provider accounts?
    answer: "Yes. Add a client's provider keys and requests for those providers are billed to the client's own account. LLM Gateway charges no platform fee on requests made with your own keys."
  - question: Can we offer this under our own brand?
    answer: "White-label options are part of the Enterprise plan. Contact us to discuss your setup."
---

## Client work makes AI spend hard to see

An agency runs many products for many clients, often on one provider account. At the end of the month there is a single bill and no clean way to say which client used what. Sharing one key across projects also means one client's spike can exhaust everyone's rate limit.

An **LLM gateway for agencies** fixes the accounting. **LLM Gateway** separates usage by project and API key while every request still goes through one API.

## Separate clients by project and key

Create a project per client and issue keys inside it. The code is the same for every client; only the key changes:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

## Bill back from real numbers

Each request is logged with its model, token counts, latency, and cost. Usage is grouped by API key, so a client's monthly AI cost is a report instead of an estimate.

## Stop overruns before they happen

Set a usage limit on a client's key. When it is reached, requests are rejected until you raise the limit, which keeps a fixed-price engagement from losing money.

## Use the client's own contracts

When a client has its own provider agreement, add their provider keys. Usage is billed on their account and LLM Gateway adds no platform fee.

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Read the quick start](https://docs.llmgateway.io/quick-start)**
- **[Read about API keys](https://docs.llmgateway.io/features/api-keys)**
