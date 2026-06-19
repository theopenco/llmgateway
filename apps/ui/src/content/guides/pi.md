---
id: pi
slug: pi
title: Pi Coding Agent Integration
description: Use any model with Pi coding agent through LLM Gateway — GPT-5.5, Gemini 3.1 Pro, Claude Opus 4.7, DeepSeek V4, and 200+ others in your terminal.
date: 2026-05-13
---

[Pi](https://pi.dev) is a minimal terminal-based coding agent that gives an AI full access to read, write, edit, and run shell commands in your project. By pointing Pi at LLM Gateway, you can use any of our 280+ models with full cost tracking and caching.

## Quick Start

Configure Pi to use LLM Gateway by editing `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "llmgateway": {
      "baseUrl": "https://api.llmgateway.io/v1",
      "api": "openai-completions",
      "apiKey": "llmgtwy_your_api_key_here",
      "models": [
        { "id": "gpt-5.5", "name": "GPT-5.5" },
        { "id": "claude-opus-4-7", "name": "Claude Opus 4.7" },
        { "id": "gemini-3.1-pro", "name": "Gemini 3.1 Pro" },
        { "id": "deepseek-v4", "name": "DeepSeek V4", "reasoning": true }
      ]
    }
  }
}
```

Then run `pi` in any project directory and type `/model` to select your LLM Gateway model.

## Setup Steps

1. **Get Your API Key** — Log in to your [LLM Gateway dashboard](https://llmgateway.io/dashboard) and create a new API key
2. **Edit models.json** — Add the LLM Gateway provider config shown above to `~/.pi/agent/models.json`
3. **Select Model** — Run `pi`, type `/model`, and pick your model
4. **Start Coding** — All requests route through LLM Gateway with full cost tracking

## Adding More Models

Add any model from the [models page](https://llmgateway.io/models) to the `models` array in your config:

```json
{ "id": "gpt-5.5-mini", "name": "GPT-5.5 Mini" },
{ "id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6" },
{ "id": "gemini-3.1-flash", "name": "Gemini 3.1 Flash" },
{ "id": "deepseek-v4-mini", "name": "DeepSeek V4 Mini", "reasoning": true }
```

## Using Environment Variables

Reference an env var instead of hardcoding your key:

```json
"apiKey": "LLM_GATEWAY_API_KEY"
```

```bash
export LLM_GATEWAY_API_KEY=llmgtwy_your_api_key_here
```

## Troubleshooting

- **Auth errors**: Verify API key and base URL (`https://api.llmgateway.io/v1`)
- **Model not found**: Copy model IDs exactly from the [models page](https://llmgateway.io/models)
- **Connection issues**: Ensure `api` is set to `"openai-completions"`

Need help? Join our [Discord community](https://llmgateway.io/discord).
