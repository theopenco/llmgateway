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

**1. Log out of ChatGPT** if you're logged in (stored sessions override custom config):

```bash
codex logout
```

**2. Create or edit** your Codex CLI config file at `~/.codex/config.toml`:

```bash
model = "auto"
model_reasoning_effort = "high"
openai_base_url = "https://api.llmgateway.io/v1"
```

**3. Run Codex CLI:**

```bash
codex
```

On first launch, Codex will prompt you for authentication. Select **Provide your own API key**, then enter your LLM Gateway API key (starts with `llmgtwy_`).

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

If you see `401 Unauthorized` or requests going to `api.openai.com` instead of LLM Gateway:

1. Make sure you've run `codex logout` to clear any ChatGPT session
2. Verify `openai_base_url` is set in `~/.codex/config.toml`
3. When Codex prompts for authentication, select **Provide your own API key** and enter your LLM Gateway key (starts with `llmgtwy_`)

### Model not found

Verify the model ID matches exactly what's listed on the [models page](https://llmgateway.io/models). Model IDs are case-sensitive.

### Connection issues

Check that `openai_base_url` is set to `https://api.llmgateway.io/v1` (note the `/v1` at the end).

## Get Started

1. [Sign up free](https://llmgateway.io/signup) — no credit card required
2. Copy your API key from the dashboard
3. Run `codex logout` to clear any existing ChatGPT session
4. Create the config file above
5. Run `codex`, select **Provide your own API key** when prompted, and paste your LLM Gateway key

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
