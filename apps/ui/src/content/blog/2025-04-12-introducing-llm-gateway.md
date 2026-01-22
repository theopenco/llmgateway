---
id: blog-introducing-llm-gateway
slug: introducing-llm-gateway
date: 2025-04-12
title: Introducing LLM Gateway
summary: One API for 180+ models across 60+ providers. Route requests, track costs, and switch models without changing your code.
categories: ["Announcements"]
image:
  src: "/blog/blog-introducing-llm-gateway.png"
  alt: "LLM Gateway"
  width: 2282
  height: 1198
---

# LLM Gateway

LLM Gateway is an open-source API gateway that sits between your apps and LLM providers. One integration gives you access to 180+ models from 60+ providers—and the visibility to control costs.

- **Route**: Switch between OpenAI, Anthropic, Google, and 60+ other providers without changing your code
- **Manage**: One dashboard for all your API keys—no more scattered credentials
- **Observe**: Track every request's cost, latency, and token usage in real-time
- **Optimize**: Compare models side-by-side to find the best price-to-performance ratio

## Why LLM Gateway?

If you've built with multiple LLM providers, you know the pain: different SDKs, scattered API keys, no unified view of what you're spending. LLM Gateway gives you a single API that works with any provider—and a dashboard that shows exactly where your money goes.

## One Compatible Endpoint

Already using OpenAI's SDK? Keep your code. Just change the base URL:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello, how are you?"}]
  }'
```

## See Every Request, Every Dollar

Every API call is tracked with:

- **Cost per request** — Know exactly what each prompt costs
- **Latency breakdowns** — See response times by model and provider
- **Error rates** — Spot reliability issues before they hit production
- **Token usage** — Track input and output tokens across all requests

No more guessing where your AI spend goes. Compare models head-to-head and make data-driven decisions.

Ready to try it? [Get started free](/signup) — no credit card required.
