---
id: use-case-cost-optimization
slug: cost-optimization
date: 2026-06-02
title: AI cost optimization & FinOps
metaTitle: "LLM Gateway for AI Cost Optimization & FinOps"
description: "Cut LLM spend without changing your code. Smart routing, prompt caching, and per-request analytics show where every token goes and route each call to the cheapest model that works."
headline: "See where every token goes, cache repeat context, and route to the cheapest model that clears the bar."
summary: "Reduce LLM spend with per-request analytics, prompt caching, and routing to cheaper models — all through one OpenAI-compatible API."
benefits:
  - title: See where every token goes
    description: "Per-request logging of model, tokens, latency and dollar cost turns an opaque LLM bill into a breakdown you can actually act on."
  - title: Route to the cheapest model that works
    description: "Send each request to the most affordable model that meets the bar, with frontier models reserved for the calls that truly need them."
  - title: Cache repeated context
    description: "Prompt caching stops you paying full price for system prompts and context that get resent on every call."
  - title: One view across every provider
    description: "Spend across OpenAI, Anthropic, Google and the rest lands in one dashboard instead of a dozen separate billing pages."
faqs:
  - question: How does LLM Gateway reduce my LLM costs?
    answer: "Three ways: visibility (per-request cost analytics so you can find waste), routing (send each request to the cheapest model that meets your quality bar), and caching (avoid paying full price for repeated prompt context). Together they cut spend without requiring you to rewrite your application."
  - question: Do I have to change my code to save money?
    answer: "Very little. The gateway is OpenAI-compatible, so adopting it is a base-URL and key change. From there, routing, caching and analytics are configuration — not a rewrite of your application logic."
  - question: Can I attribute spend to teams or features?
    answer: "Yes. Requests are logged and can be grouped by API key, so issuing keys per team, environment or feature gives you clean cost attribution — the foundation of any AI FinOps practice."
  - question: Does using a gateway add latency or markup?
    answer: "The routing overhead is minimal, and the savings from caching and cheaper-model routing typically outweigh it many times over. You also get one consolidated view of spend instead of reconciling bills across providers."
---

## Most LLM bills are a black box — that's the real problem

Teams rarely overspend on LLMs on purpose. They overspend because the bill is opaque: one big number, no breakdown of which feature, model or prompt drove it, and no easy way to test a cheaper alternative. You can't optimize what you can't see.

LLM Gateway makes spend legible and then gives you the levers to lower it — visibility, routing, and caching — through one OpenAI-compatible API.

## Step one: make every token visible

The gateway logs each request with its model, token counts, latency and exact dollar cost. Group those by API key and the opaque monthly number becomes a breakdown by team, environment or feature:

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.llmgateway.io/v1",
  apiKey: process.env.LLM_GATEWAY_API_KEY,
});

// Every call below is logged with model, tokens, latency and cost —
// across every provider, in one dashboard.
const response = await client.chat.completions.create({
  model: "openai/gpt-5.1",
  messages,
});
```

## Step two: route to the cheapest model that clears the bar

Once you can see cost per request, the waste is obvious — flagship models doing work a cheaper model handles fine. Routing lets you send each request to the most affordable model that meets your quality bar, and keep the expensive models for the calls that genuinely need them. Switching is a one-line model change, so testing a cheaper option is cheap itself.

## Step three: stop paying for the same tokens twice

System prompts, instructions and shared context get resent on nearly every call. Prompt caching means those repeated tokens don't cost full price each time — one of the highest-leverage savings in most production workloads.

## FinOps for AI, in one place

Per-key attribution, one dashboard across every provider, and cost data on every request give you the foundation of an AI FinOps practice: budgets you can defend, spend you can attribute, and a clear before-and-after when you tune routing or caching — without a rewrite.
