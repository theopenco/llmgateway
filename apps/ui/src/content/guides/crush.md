---
id: crush
slug: crush
title: Crush Integration
description: Use any model with Crush, Charm's glamorous terminal coding agent. One OpenAI-compatible endpoint, automatic provider routing, full cost tracking.
date: 2026-07-21
---

[Crush](https://github.com/charmbracelet/crush) is Charm's open-source AI coding agent for the terminal. It edits files, runs commands, and works through multi-step tasks with a polished TUI. Point it at LLM Gateway and every session runs on any model in our catalog — with one API key, automatic provider failover, and per-request cost tracking.

## Prerequisites

- An LLM Gateway API key — [sign up free](/signup) (no credit card required)

## Setup

### Step 1: Install Crush

- **Homebrew (macOS/Linux)**:

  ```bash
  brew install charmbracelet/tap/crush
  ```

- **npm**:

  ```bash
  npm install -g @charmland/crush
  ```

Other install methods (Scoop, Chocolatey, apt, yum, Go) are listed in the [Crush README](https://github.com/charmbracelet/crush#installation).

Confirm the installation:

```bash
crush --version
```

### Step 2: Set your API key

```bash
export LLMGATEWAY_API_KEY=your_api_key_here
```

Get your key from the [LLM Gateway dashboard](/dashboard).

### Step 3: Add LLM Gateway as a provider

Create a `crush.json` in your project directory (or `~/.config/crush/crush.json` to apply globally):

```json
{
  "$schema": "https://charm.land/crush.json",
  "providers": {
    "llmgateway": {
      "name": "LLM Gateway",
      "type": "openai-compat",
      "base_url": "https://api.llmgateway.io/v1",
      "api_key": "$LLMGATEWAY_API_KEY",
      "models": [
        {
          "id": "claude-sonnet-5",
          "name": "Claude Sonnet 5",
          "cost_per_1m_in": 2,
          "cost_per_1m_out": 10,
          "context_window": 1000000,
          "default_max_tokens": 128000,
          "can_reason": true,
          "supports_attachments": true
        },
        {
          "id": "claude-haiku-4-5",
          "name": "Claude Haiku 4.5",
          "cost_per_1m_in": 1,
          "cost_per_1m_out": 5,
          "context_window": 200000,
          "default_max_tokens": 64000,
          "can_reason": true,
          "supports_attachments": true
        }
      ]
    }
  }
}
```

Add an entry to `models` for any model you want to use — every ID from the [models catalog](https://llmgateway.io/models) works, and the catalog lists each model's context window and pricing.

### Step 4: Start coding

Launch Crush in your project:

```bash
crush
```

Pick a model from the LLM Gateway provider when prompted (or switch anytime from within Crush). Every request now routes through LLM Gateway and shows up in your [dashboard](/dashboard) with per-request costs.

## Picking the right model

Crush works the codebase hard: long contexts, lots of tool calls. A few tips:

- **Frontier coding models** give the best autonomous results — browse the [catalog](https://llmgateway.io/models) sorted by capability
- **Discounted models**: check the [discounted list](https://llmgateway.io/models?view=grid&filters=1&discounted=true) — same models, lower price through partner providers
- **Provider pinning**: prefix the model ID with a provider (e.g. `anthropic/claude-sonnet-5`) to pin routing; bare IDs get automatic provider selection with failover
- **Free models**: try [free models](https://llmgateway.io/models?view=grid&filters=1&free=true) for low-stakes tasks

## Troubleshooting

**Authentication errors** — Double-check the key and that the base URL is exactly `https://api.llmgateway.io/v1`.

**Model not found** — Copy the model ID exactly from the [models page](https://llmgateway.io/models).

**Context overflow on big tasks** — Switch to a model with a larger context window; the catalog lists context sizes per model, and set `context_window` in your `crush.json` to match.

Need help? Join our [Discord](https://llmgateway.io/discord).

## Why route Crush through LLM Gateway

- **Any model, one key** — OpenAI, Anthropic, Google, Meta, DeepSeek, and open-source models through one endpoint
- **Automatic failover** — bare model IDs route to the best available provider and fall over automatically
- **Cost control** — per-request cost tracking and spend limits in the [dashboard](/dashboard)
- **Response caching** — repeated requests hit cache automatically

[Get started for free](/signup) — no credit card required.
