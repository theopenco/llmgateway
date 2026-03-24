---
id: autohand
slug: autohand
title: Autohand Integration
description: Use GPT-5, Claude, Gemini, or any model with Autohand's autonomous coding agent. Simple config, full cost tracking.
date: 2026-03-19
---

Autohand is an autonomous AI coding agent that works in your terminal, IDE, and Slack. With LLM Gateway, you can route all Autohand requests through a single gateway—use any of 180+ models from 60+ providers, with full cost tracking and smart routing.

## Quick Start

Configure Autohand to use LLM Gateway by setting the base URL and API key:

```bash
export OPENAI_BASE_URL=https://api.llmgateway.io/v1
export OPENAI_API_KEY=llmgtwy_your_api_key_here
```

Then start Autohand as usual:

```bash
autohand
```

Autohand will now route all requests through LLM Gateway.

## Configuration File

You can also configure LLM Gateway in Autohand's config file. Add or update the provider settings:

```json
{
  "provider": {
    "llmgateway": {
      "baseUrl": "https://api.llmgateway.io/v1",
      "apiKey": "llmgtwy_your_api_key_here"
    }
  },
  "model": "gpt-5"
}
```

## Why Use LLM Gateway with Autohand

- **180+ models** — GPT-5, Claude Opus, Gemini, Llama, and more from 60+ providers
- **Smart routing** — Automatically selects the best provider based on uptime, throughput, price, and latency
- **Cost tracking** — Monitor exactly how much each autonomous session costs
- **Single bill** — No need to manage multiple API provider accounts
- **Response caching** — Repeated requests hit cache automatically
- **Automatic failover** — If one provider is down, requests route to another

## Choosing Models

You can use any model from the [models page](https://llmgateway.io/models). Popular options for Autohand:

| Model               | Best For                                    |
| ------------------- | ------------------------------------------- |
| `gpt-5`             | Latest OpenAI flagship, highest quality     |
| `claude-opus-4-6`   | Anthropic's most capable model              |
| `claude-sonnet-4-6` | Fast reasoning with extended thinking       |
| `gemini-2.5-pro`    | Google's latest flagship, 1M context window |
| `o3`                | Advanced reasoning tasks                    |
| `gpt-5-mini`        | Cost-effective, quick responses             |
| `gemini-2.5-flash`  | Fast responses, good for high-volume        |
| `deepseek-v3.1`     | Open-source with vision and tools           |

## Autohand Features with LLM Gateway

### Terminal (CLI)

Autohand CLI works seamlessly with LLM Gateway. Set the environment variables and use all Autohand commands as normal—multi-file editing, agentic search, and autonomous code generation all work out of the box.

### IDE Integration

Autohand's VS Code and Zed extensions respect the same environment variables. Set them in your shell profile and the IDE integration will automatically route through LLM Gateway.

### Slack Integration

When using Autohand through Slack, configure the LLM Gateway base URL in your Autohand server settings to route all Slack-triggered coding tasks through the gateway.

## Monitoring Usage

Once configured, all Autohand requests appear in your LLM Gateway dashboard:

- **Request logs** — See every prompt and response
- **Cost breakdown** — Track spending by model and time period
- **Usage analytics** — Understand your AI usage patterns

## Get Started

1. [Sign up free](https://llmgateway.io/signup) — no credit card required
2. Copy your API key from the dashboard
3. Set the environment variables above
4. Run `autohand` and start coding

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
