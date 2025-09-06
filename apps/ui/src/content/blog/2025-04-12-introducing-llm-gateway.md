---
id: blog-introducing-llm-gateway
slug: introducing-llm-gateway
date: 2025-04-12
title: Introducing LLM Gateway
summary: Meet the open-source API gateway for routing, observability, and cost tracking across LLM providers.
categories: ["Announcements"]
image:
  src: "/blog/blog-introducing-llm-gateway.png"
  alt: "LLM Gateway"
  width: 2282
  height: 1198
---

# LLM Gateway

LLM Gateway is an open-source API gateway for Large Language Models (LLMs). It acts as middleware between your apps and LLM providers so you can:

- **Route**: Switch between providers like OpenAI, Anthropic, and Google with a single API
- **Manage**: Centralize and rotate provider API keys
- **Observe**: Track token usage, latency, and error rates
- **Optimize**: Analyze cost and performance to pick the best models for your workload

## Why LLM Gateway?

Operating across multiple LLM providers quickly becomes complex credentials, SDK differences, changing models, and cost variance. LLM Gateway standardizes the interface and gives you the visibility to make data-driven choices.

## One Compatible Endpoint

LLM Gateway uses an OpenAI-compatible API format, so migrating is seamless:

```bash
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello, how are you?"}]
  }'
```

## Deep Observability

Get **usage metrics**, **cost analysis**, and **performance tracking** broken down by model and provider, helping you reason about tradeoffs. You can compare latency, token usage, and error rates to choose the best fit per task.

If you're new to LLM Gateway, read our [Docs](/docs) to get started.
