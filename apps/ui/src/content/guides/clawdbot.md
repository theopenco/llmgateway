---
id: clawdbot
slug: clawdbot
title: Clawdbot Integration
description: Use GPT-5, Gemini, or any model with Clawdbot Discord bot. Simple configuration, full cost tracking.
date: 2026-01-26
---

Clawdbot is an AI-powered Discord bot that brings powerful language models to your server. With LLM Gateway, you can use any model—GPT-5, Gemini, Llama, Claude, or 180+ others—while keeping full visibility into your usage and costs.

## Quick Start

Configure Clawdbot to use LLM Gateway by setting these environment variables:

```bash
OPENAI_API_BASE=https://api.llmgateway.io/v1
OPENAI_API_KEY=llmgtwy_your_api_key_here
OPENAI_MODEL=gpt-5  # or any model from our catalog
```

## Why Use LLM Gateway with Clawdbot

- **Model flexibility** — Switch between GPT-5, Claude, Gemini, or any of 180+ models
- **Cost tracking** — Monitor exactly how much your Discord bot costs to run
- **Single bill** — No need to manage multiple API provider accounts
- **Response caching** — Repeated queries hit cache, reducing costs
- **Rate limit handling** — Automatic fallback between providers

## Configuration Options

### Using OpenAI-Compatible Models

```bash
OPENAI_API_BASE=https://api.llmgateway.io/v1
OPENAI_API_KEY=llmgtwy_your_api_key_here
OPENAI_MODEL=gpt-5
```

### Using Claude Models

```bash
OPENAI_API_BASE=https://api.llmgateway.io/v1
OPENAI_API_KEY=llmgtwy_your_api_key_here
OPENAI_MODEL=anthropic/claude-sonnet-4-20250514
```

### Using Gemini Models

```bash
OPENAI_API_BASE=https://api.llmgateway.io/v1
OPENAI_API_KEY=llmgtwy_your_api_key_here
OPENAI_MODEL=google/gemini-2.5-pro
```

## Model Name Format

LLM Gateway supports two model ID formats:

**Root Model IDs** (without provider prefix) — Uses smart routing to automatically select the best provider based on uptime, throughput, price, and latency:

```
gpt-5
claude-sonnet-4-20250514
gemini-2.5-pro
```

**Provider-Prefixed Model IDs** — Routes to a specific provider with automatic failover if uptime drops below 90%:

```
openai/gpt-5
anthropic/claude-sonnet-4-20250514
google-ai-studio/gemini-2.5-pro
```

For more details on routing behavior, see the [routing documentation](https://docs.llmgateway.io/features/routing).

## Available Models

You can use any model from the [models page](https://llmgateway.io/models). Popular choices for Discord bots include:

| Model                                                              | Best For                                |
| ------------------------------------------------------------------ | --------------------------------------- |
| `gpt-5` or `openai/gpt-5`                                          | General-purpose, high quality responses |
| `gpt-5-mini` or `openai/gpt-5-mini`                                | Cost-effective, faster responses        |
| `claude-sonnet-4-20250514` or `anthropic/claude-sonnet-4-20250514` | Thoughtful, nuanced conversations       |
| `gemini-2.5-flash` or `google-ai-studio/gemini-2.5-flash`          | Fast responses, good for high-volume    |

## Monitoring Usage

Once configured, all Clawdbot requests appear in your LLM Gateway dashboard:

- **Request logs** — See every message and response
- **Cost breakdown** — Track spending by model and time period
- **Usage analytics** — Understand your Discord server's AI usage patterns

## Tips for Discord Bots

### Optimize Costs

1. **Use smaller models for simple tasks** — GPT-5 Mini or Gemini Flash handle basic Q&A well
2. **Enable caching** — LLM Gateway caches identical requests automatically
3. **Set token limits** — Configure max tokens to prevent runaway costs

### Improve Response Quality

1. **Choose the right model** — Claude excels at nuanced conversation, GPT-5 at general tasks
2. **Use system prompts** — Configure Clawdbot's personality and capabilities
3. **Test multiple models** — LLM Gateway makes it easy to A/B test different providers

## Get Started

1. [Sign up free](https://llmgateway.io/signup) — no credit card required
2. Copy your API key from the dashboard
3. Configure Clawdbot with the environment variables above
4. Start chatting with your bot

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
