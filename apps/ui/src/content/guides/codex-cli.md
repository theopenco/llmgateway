---
id: codex-cli
slug: codex-cli
title: Codex CLI Integration
description: Use any model with OpenAI's Codex CLI through LLM Gateway. One config file, full cost tracking.
date: 2026-03-19
---

Codex CLI is OpenAI's open-source terminal coding agent. By default it connects to OpenAI's API, but with LLM Gateway you can route it through a single gateway—use GPT-5.3 Codex, Gemini, Claude, or any of 180+ models while keeping full cost visibility.

One config file. No code changes. Full cost tracking in your dashboard.

## Quick Start

Create or edit your Codex CLI config file at `~/.codex/config.toml`:

```bash
model = "auto"
model_reasoning_effort = "high"
openai_base_url = "https://api.llmgateway.io/v1"
api_key = "llmgtwy_your_api_key_here"
```

Now run Codex CLI as usual:

```bash
codex
```

## Why This Works

LLM Gateway's `/v1` endpoint is fully OpenAI-compatible. Codex CLI sends requests to our gateway instead of OpenAI directly, and we route them to the right provider behind the scenes. This means:

- **Use any model** — GPT-5.3 Codex, Gemini, Claude, or 180+ others
- **Keep your workflow** — Codex CLI doesn't know the difference
- **Track costs** — Every request appears in your LLM Gateway dashboard
- **Automatic caching** — Repeated requests hit cache, saving money

## Configuration Explained

### Base URL

The `openai_base_url` field points Codex CLI to LLM Gateway instead of OpenAI:

```bash
openai_base_url = "https://api.llmgateway.io/v1"
```

### Model Selection

Use `auto` to let LLM Gateway pick the best model, or set a specific one from the [models page](https://llmgateway.io/models):

```bash
model = "auto"
# or pick a specific model
model = "gpt-5.3-codex"
```

### Reasoning Effort

Control how much reasoning the model uses. Options are `low`, `medium`, and `high`:

```bash
model_reasoning_effort = "high"
```

## Choosing Models

Use `auto` to let LLM Gateway pick the best model automatically, or choose a specific one from the [models page](https://llmgateway.io/models):

```bash
# let LLM Gateway pick the best model
model = "auto"

# or pick a specific model
model = "gpt-5.3-codex"
```

## What You Get

- **Any model in Codex CLI** — GPT-5.3 Codex for heavy lifting, lighter models for routine tasks
- **Cost visibility** — See exactly what each coding session costs
- **One bill** — Stop managing separate accounts for OpenAI, Anthropic, Google
- **Response caching** — Repeated requests hit cache automatically
- **Discounts** — Check [discounted models](/models?discounted=true) for savings up to 90%

## Troubleshooting

### Data retention required

If you see an error like:

```
The Responses API requires data retention to be enabled.
```

Codex CLI uses the OpenAI Responses API (`/v1/responses`), which requires data retention to be enabled. To fix this:

1. Go to your [organization settings](https://llmgateway.io/dashboard) and navigate to **Settings > Policies**
2. Select **Retain All Data** and click **Save Settings**

If you prefer not to enable data retention, you can configure Codex CLI to use the Chat Completions API instead by setting the `OPENAI_CHAT_COMPLETIONS_PATH` environment variable, if supported by your Codex CLI version.

### Authentication errors

Make sure your `OPENAI_API_KEY` environment variable is set to your LLM Gateway API key (starts with `llmgtwy_`).

If you're logged into your OpenAI account in Codex CLI (via `codex login`), the stored session may take priority over your custom provider config and route requests directly to OpenAI. Run `codex logout` first to ensure requests go through LLM Gateway.

### API key not found when opening Codex App directly

If Codex CLI works from the terminal but the Codex App can't find your API key when opened from Finder or Spotlight, this is because macOS GUI apps don't inherit shell environment variables from `.zshrc` or `.bashrc`.

**Option 1: Use a config file (recommended)**

Set your API key in `~/.codex/config.toml` so it doesn't depend on environment variables:

```bash
model = "auto"
openai_base_url = "https://api.llmgateway.io/v1"
api_key = "llmgtwy_your_api_key_here"
```

### Model not found

Verify the model ID matches exactly what's listed on the [models page](https://llmgateway.io/models). Model IDs are case-sensitive.

### Connection issues

Check that `openai_base_url` is set to `https://api.llmgateway.io/v1` (note the `/v1` at the end).

## Get Started

1. [Sign up free](https://llmgateway.io/signup) — no credit card required
2. Copy your API key from the dashboard
3. Create the config file above
4. Run `codex` and start coding

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
