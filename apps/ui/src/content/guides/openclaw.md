---
id: openclaw
slug: openclaw
title: OpenClaw Integration
description: Use GPT-5.4, Claude Opus, Gemini, or any model with OpenClaw across Discord, WhatsApp, Telegram, and more. Simple configuration, full cost tracking.
date: 2026-01-26
---

OpenClaw is a self-hosted gateway that connects your favorite chat apps—WhatsApp, Telegram, Discord, iMessage, and more—to AI coding agents. With LLM Gateway as a custom provider, you can route all your OpenClaw traffic through a single API, use any of 180+ models, and keep full visibility into usage and costs.

## Quick Start

Add LLM Gateway as a custom provider in your `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "llmgateway": {
        "baseUrl": "https://api.llmgateway.io/v1",
        "apiKey": "${LLMGATEWAY_API_KEY}",
        "api": "openai-completions",
        "models": [
          {
            "id": "gpt-5.4",
            "name": "GPT-5.4",
            "contextWindow": 128000,
            "maxTokens": 32000
          },
          {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6",
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "gemini-3-1-pro-preview",
            "name": "Gemini 3.1 Pro",
            "contextWindow": 1000000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "llmgateway/gpt-5.4"
      }
    }
  }
}
```

Then set your API key:

```bash
export LLMGATEWAY_API_KEY=llmgtwy_your_api_key_here
```

## Why Use LLM Gateway with OpenClaw

- **Model flexibility** — Switch between GPT-5.4, Claude Opus, Gemini, or any of 180+ models
- **Cost tracking** — Monitor exactly how much your chat agents cost to run
- **Single bill** — No need to manage multiple API provider accounts
- **Response caching** — Repeated queries hit cache, reducing costs
- **Rate limit handling** — Automatic fallback between providers

## Configuration Options

### Switching Models

Change the primary model in your config to switch between any model:

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "llmgateway/claude-opus-4-6" }
    }
  }
}
```

### Model Fallback Chain

OpenClaw supports fallback models. If the primary model is unavailable, it automatically falls back:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "llmgateway/gpt-5.4",
        "fallbacks": ["llmgateway/claude-opus-4-6"]
      }
    }
  }
}
```

## Available Models

LLM Gateway uses root model IDs with smart routing—automatically selecting the best provider based on uptime, throughput, price, and latency. You can use any model from the [models page](https://llmgateway.io/models). Flagship models include:

| Model                    | Best For                                    |
| ------------------------ | ------------------------------------------- |
| `gpt-5.4`                | Latest OpenAI flagship, highest quality     |
| `claude-opus-4-6`        | Anthropic's most capable model              |
| `claude-sonnet-4-6`      | Fast reasoning with extended thinking       |
| `gemini-3-1-pro-preview` | Google's latest flagship, 1M context window |
| `o3`                     | Advanced reasoning tasks                    |
| `gpt-5.4-pro`            | Premium tier with extended reasoning        |
| `gemini-2.5-flash`       | Fast responses, good for high-volume        |
| `claude-haiku-4-5`       | Cost-effective, quick responses             |
| `grok-3`                 | xAI flagship                                |
| `deepseek-v3.1`          | Open-source with tool support               |

For more details on routing behavior, see the [routing documentation](https://docs.llmgateway.io/features/routing).

## Monitoring Usage

Once configured, all OpenClaw requests appear in your LLM Gateway dashboard:

- **Request logs** — See every message and response
- **Cost breakdown** — Track spending by model and time period
- **Usage analytics** — Understand your AI usage patterns across channels

## Tips for Chat Agents

### Optimize Costs

1. **Use smaller models for simple tasks** — Claude Haiku or Gemini Flash handle basic Q&A well
2. **Enable caching** — LLM Gateway caches identical requests automatically
3. **Set token limits** — Configure max tokens to prevent runaway costs

### Improve Response Quality

1. **Choose the right model** — Claude Opus excels at nuanced conversation, GPT-5.4 at general tasks
2. **Use system prompts** — Configure your agent's personality and capabilities
3. **Test multiple models** — LLM Gateway makes it easy to A/B test different providers

## Get Started

1. [Sign up free](https://llmgateway.io/signup) — no credit card required
2. Copy your API key from the dashboard
3. Add LLM Gateway as a custom provider in your OpenClaw config
4. Start chatting across your connected channels

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
