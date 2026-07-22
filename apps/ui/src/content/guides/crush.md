---
id: crush
slug: crush
title: Crush Integration
description: Connect Charm's Crush coding agent to 200+ models through LLM Gateway's built-in provider. No config files needed — just select, authenticate, and code.
date: 2026-07-22
---

[Crush](https://github.com/charmbracelet/crush) is Charm's glamorous open-source AI coding agent for your terminal. LLM Gateway is a built-in provider in Crush, so setup takes under a minute — export your API key, pick LLM Gateway from the provider list, and you have access to 200+ models from 40+ providers, all tracked in one dashboard.

## Prerequisites

Install Crush with your package manager of choice:

```bash
# Homebrew
brew install charmbracelet/tap/crush

# NPM
npm install -g @charmland/crush
```

See the [Crush README](https://github.com/charmbracelet/crush#installation) for Windows, Arch, Nix, and FreeBSD instructions.

You also need an LLM Gateway API key — [sign up](/signup) and create one from your dashboard.

## Setup

### Step 1: Set Your API Key

Export your LLM Gateway API key in your shell:

```bash
export LLMGATEWAY_API_KEY=your-api-key-here
```

Add it to your shell profile (`~/.zshrc` or `~/.bashrc`) to make it permanent.

### Step 2: Select LLM Gateway

Launch Crush:

```bash
crush
```

LLM Gateway is listed as a built-in provider. Select "LLM Gateway" from the provider list — with `LLMGATEWAY_API_KEY` set, Crush picks up your credentials automatically.

### Step 3: Start Coding

Select a model and start building. You can switch models at any time from within Crush.

## Why Use LLM Gateway with Crush?

- **200+ models** — GPT-5, Claude, Gemini, Kimi, GLM, and more from 40+ providers
- **One API key** — Stop juggling credentials for every provider
- **Cost tracking** — See what each coding session costs in your dashboard
- **Automatic fallback** — Requests route to a healthy provider if one is down
- **Volume discounts** — The more you use, the more you save

## Manual Configuration

The built-in provider needs no config files. If you want to customize the setup — for example to pin request headers or maintain an explicit model list — you can define the provider yourself in a `crush.json` in your project directory (or `~/.config/crush/crush.json` for a global setup):

```json
{
  "$schema": "https://charm.land/crush.json",
  "providers": {
    "llmgateway": {
      "name": "LLM Gateway",
      "type": "openai-compat",
      "base_url": "https://api.llmgateway.io/v1",
      "api_key": "$LLMGATEWAY_API_KEY"
    }
  }
}
```

Crush auto-discovers all available models from LLM Gateway's `/v1/models` endpoint, so there is no model list to maintain.

## Locking to a Specific Provider

By default, LLM Gateway automatically fails over to alternative providers if your chosen provider is experiencing downtime. If you want to lock into a specific provider/model mapping, use a manual provider config and pass the `X-No-Fallback` header:

```json
{
  "$schema": "https://charm.land/crush.json",
  "providers": {
    "llmgateway": {
      "name": "LLM Gateway",
      "type": "openai-compat",
      "base_url": "https://api.llmgateway.io/v1",
      "api_key": "$LLMGATEWAY_API_KEY",
      "extra_headers": {
        "X-No-Fallback": "true"
      }
    }
  }
}
```

Note that disabling fallback means requests will fail if the chosen provider is down.

## Switching Models

Use Crush's model picker to switch between any of the discovered models. View all available models on the [models page](/models).

## Troubleshooting

### 401 Unauthorized

Verify `LLMGATEWAY_API_KEY` is exported in the shell where you launch Crush and that the key is active in your [dashboard](/dashboard).

### 404 Not Found with manual config

Verify your `base_url` is set to `https://api.llmgateway.io/v1` (note the `/v1` at the end).

### Models not showing up

Model discovery runs when Crush starts — restart Crush after adding or changing the provider config.

## Get Started

Ready to use Crush with any model? [Sign up for LLM Gateway](/signup) and get your API key today.
