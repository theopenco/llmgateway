---
id: cursor
slug: cursor
title: Cursor Integration
description: Point Cursor's chat at any of 280+ models through LLM Gateway. One base URL override, full cost tracking — with an honest look at what Cursor does and doesn't allow.
date: 2026-07-03
---

Cursor is an AI-powered code editor built on VS Code. It supports a custom OpenAI base URL, which means you can point its chat panel at LLM Gateway and use any model from our catalog — GPT-5, Claude, Gemini, DeepSeek, or 280+ others — with every request tracked in your dashboard.

One thing up front, because most guides skip it: **the base URL override only applies to Cursor's chat / plan mode.** Composer, inline edit (Cmd/Ctrl + K), and autocomplete are locked to Cursor's own backend and will not route through any external endpoint. If you want a full coding agent running through LLM Gateway, use [Claude Code](/guides/claude-code), [Codex CLI](/guides/codex-cli), [Cline](/guides/cline), or [OpenCode](/guides/opencode) instead.

## Quick Start

### 1. Get your API key

Create an API key in your [LLM Gateway dashboard](/dashboard) under **API Keys**.

### 2. Add the key to Cursor

Open **Cursor Settings → Models**, then add your LLM Gateway key under **OpenAI API Key**.

![Cursor Settings](https://docs.llmgateway.io/guides/cursor/settings-1.png)

### 3. Override the base URL

In the same Models settings, enable **Override OpenAI Base URL** and set it to:

```
https://api.llmgateway.io/v1
```

![Cursor API Key Input](https://docs.llmgateway.io/guides/cursor/settings-2.png)

### 4. Pick your models

Add any model ID from the [models catalog](https://llmgateway.io/models) — for example `gpt-5`, `claude-sonnet-4-5`, or `deepseek-v3.2`.

![Cursor Model Selection](https://docs.llmgateway.io/guides/cursor/model-selection.png)

Open the chat panel (Cmd/Ctrl + L) and every request now routes through LLM Gateway.

## What works and what doesn't

| Cursor feature                  | Routes through LLM Gateway |
| ------------------------------- | -------------------------- |
| Chat / plan mode (Cmd/Ctrl + L) | ✅ Yes                     |
| Composer / coding agent         | ❌ Cursor backend only     |
| Inline edit (Cmd/Ctrl + K)      | ❌ Cursor backend only     |
| Autocomplete / tab              | ❌ Cursor backend only     |

This is a Cursor limitation, not an LLM Gateway one — external OpenAI-compatible endpoints are only honored by the chat panel.

## Model selection tips

- **Provider pinning**: prefix the model with a provider to pin it, e.g. `openai/gpt-5`
- **Discounted models**: browse the [discounted models](https://llmgateway.io/models?view=grid&filters=1&discounted=true) and copy the ID
- **Free models**: browse the [free models](https://llmgateway.io/models?view=grid&filters=1&free=true)
- **Reasoning models**: browse [reasoning models](https://llmgateway.io/models?view=grid&filters=1&reasoning=true) for planning-heavy work

## Troubleshooting

**Authentication errors** — Verify the API key and that the base URL is exactly `https://api.llmgateway.io/v1`, and check that your account has credits.

**Model not found** — Confirm the model ID exists in the [catalog](https://llmgateway.io/models) and is spelled exactly as shown.

**Composer or autocomplete still uses Cursor's models** — Expected; see the table above.

Need help? Join our [Discord](https://llmgateway.io/discord).

## Why route Cursor through LLM Gateway

- **Any model in the chat panel** — OpenAI, Anthropic, Google, Meta, DeepSeek, and open-source models through one key
- **Cost tracking** — every chat request appears in your [dashboard](/dashboard) with per-model cost breakdowns
- **Caching** — repeated prompts hit the cache instead of the provider
- **One bill** — no juggling separate provider accounts

[Get started for free](/signup) — no credit card required.
