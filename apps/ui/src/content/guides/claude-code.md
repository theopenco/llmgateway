---
id: claude-code
slug: claude-code
title: Claude Code Integration
description: Use GPT-5, Gemini, or any model with Claude Code. Three environment variables, full cost tracking.
date: 2026-01-02
---

Claude Code is locked to Anthropic's API by default. With LLM Gateway, you can point it at any model—GPT-5, Gemini, Llama, or 180+ others—while keeping the same Anthropic API format Claude Code expects.

Three environment variables. No code changes. Full cost tracking in your dashboard.

## Video Tutorial

Set up Claude Code with LLM Gateway in under 2 minutes:

<iframe width="560" height="315" src="https://www.youtube.com/embed/FrNDDSER768" title="Claude Code with LLM Gateway" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

## Quick Start

Configure Claude Code to use LLM Gateway with these environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=llmgtwy_your_api_key_here
# optional: specify a model, otherwise it uses the default Claude model
export ANTHROPIC_MODEL=gpt-5  # or any model from our catalog

# now run claude!
claude
```

## Why This Works

LLM Gateway's `/v1/messages` endpoint speaks Anthropic's API format natively. We handle the translation to each provider behind the scenes. This means:

- **Use any model** — GPT-5, Gemini, Llama, or Claude itself
- **Keep your workflow** — Claude Code doesn't know the difference
- **Track costs** — Every request appears in your LLM Gateway dashboard
- **Automatic caching** — Repeated requests hit cache, saving money

## Choosing Models

You can use any model from the [models page](https://llmgateway.io/models). Popular options for Claude Code include:

### Use OpenAI's Latest Models

```bash
# Use the latest GPT model
export ANTHROPIC_MODEL=gpt-5

# Use a cost-effective alternative
export ANTHROPIC_MODEL=gpt-5-mini
```

### Use Google's Gemini

```bash
export ANTHROPIC_MODEL=gemini-2.5-pro
```

### Use Anthropic's Claude Models

```bash
export ANTHROPIC_MODEL=anthropic/claude-3-5-sonnet-20241022
```

## Environment Variables

When configuring Claude Code, you can use these environment variables:

### ANTHROPIC_MODEL

Specifies the main model to use for primary requests.

```bash
export ANTHROPIC_MODEL=gpt-5
```

### Complete Configuration Example

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=llmgtwy_your_api_key_here
export ANTHROPIC_MODEL=gpt-5
export ANTHROPIC_SMALL_FAST_MODEL=gpt-5-nano
```

## Making Manual API Requests

If you want to test the endpoint directly, you can make manual requests:

```bash
curl -X POST "https://api.llmgateway.io/v1/messages" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "max_tokens": 100
  }'
```

### Response Format

The endpoint returns responses in Anthropic's message format:

```json
{
  "id": "msg_abc123",
  "type": "message",
  "role": "assistant",
  "model": "gpt-5",
  "content": [
    {
      "type": "text",
      "text": "Hello! I'm doing well, thank you for asking. How can I help you today?"
    }
  ],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 13,
    "output_tokens": 20
  }
}
```

## What You Get

- **Any model in Claude Code** — GPT-5 for heavy lifting, GPT-4o Mini for routine tasks
- **Cost visibility** — See exactly what each coding session costs
- **One bill** — Stop managing separate accounts for OpenAI, Anthropic, Google
- **Response caching** — Repeated requests (like linting the same file) hit cache
- **Discounts** — Check [discounted models](/models?discounted=true) for savings up to 90%

## Get Started

1. [Sign up free](https://llmgateway.io/signup) — no credit card required
2. Copy your API key from the dashboard
3. Set the three environment variables above
4. Run `claude` and start coding

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
