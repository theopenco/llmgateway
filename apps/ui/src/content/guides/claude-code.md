---
id: claude-code
slug: claude-code
title: Claude Code Integration
description: Configure Claude Code to use LLM Gateway for access to any model through the Anthropic API format
date: 2026-01-02
---

LLM Gateway provides a native Anthropic-compatible endpoint at `/v1/messages` that allows you to use any model in our catalog while maintaining the familiar Anthropic API format. This is especially useful for Claude Code users who want to access models beyond Claude.

## Video Tutorial

Watch this quick video guide on setting up Claude Code with LLM Gateway:

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

## Why Use LLM Gateway with Claude Code?

The Anthropic endpoint transforms requests from Anthropic's message format to the OpenAI-compatible format used by LLM Gateway, then transforms the responses back to Anthropic's format. This means you can:

- Use **any model** available in LLM Gateway with Claude Code
- Maintain existing workflows that use Anthropic's API format
- Access models from OpenAI, Google, Cohere, and other providers through the Anthropic interface
- Leverage LLM Gateway's routing, caching, and cost optimization features

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
export ANTHROPIC_MODEL=google/gemini-2.5-pro
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

## Benefits of Using LLM Gateway

- **Multi-Provider Access**: Use models from OpenAI, Anthropic, Google, and more through a single API
- **Cost Control**: Track and limit your AI spending with detailed usage analytics
- **Unified Billing**: One account for all providers instead of managing multiple API keys
- **Caching**: Reduce costs with response caching for repeated requests
- **Analytics**: Monitor usage patterns and costs in the dashboard
- **Discounts**: Visit [Models page](/models?discounted=true)

## Get Started

Ready to enhance your Claude Code experience? [Sign up for LLM Gateway](/signup) and get your API key today.
