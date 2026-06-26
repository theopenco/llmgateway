---
id: opencode-desktop
slug: opencode-desktop
title: OpenCode Desktop Integration
description: Connect OpenCode Desktop to 280+ models through LLM Gateway. No config files — just open Settings, connect, and start building.
date: 2026-05-11
---

[OpenCode Desktop](https://opencode.ai/download) is the GUI desktop app version of OpenCode — an open-source AI coding agent with a full visual interface for managing providers, models, and sessions. LLM Gateway is a built-in provider, so setup takes under a minute with no config files required.

## Prerequisites

- OpenCode Desktop installed — [download for Windows or macOS](https://opencode.ai/download)
- An LLM Gateway API key — [sign up free](/signup) (no credit card required)

## Installation

Download OpenCode Desktop from [opencode.ai/download](https://opencode.ai/download) and install it for your platform:

- **macOS (Apple Silicon)** — `.dmg` installer
- **macOS (Intel)** — `.dmg` installer
- **Windows** — `.exe` installer

You can also install on macOS via Homebrew:

```bash
brew install --cask opencode-desktop
```

## Setup

### Step 1: Open Providers Settings

Launch OpenCode Desktop. Click the **Providers** section in the left sidebar under **Server**. You'll see the list of built-in providers:

![OpenCode Desktop Providers screen](/images/guides/opencode-desktop/0-providers.png)

### Step 2: Find LLM Gateway

Click **Show more providers** at the bottom of the list, or click **+ Connect** on any entry to open the provider search. Type `LLM` in the search box — **LLM Gateway** will appear under "Other":

![Searching for LLM Gateway](/images/guides/opencode-desktop/1-search-llm.png)

Select **LLM Gateway** from the list.

### Step 3: Enter Your API Key

OpenCode will show the **Connect LLM Gateway** dialog. Paste your LLM Gateway API key (starts with `llmgtwy_`) and click **Continue**:

![Connect LLM Gateway — enter API key](/images/guides/opencode-desktop/2-connect-api-key.png)

[Sign up](/signup) or log in to your LLM Gateway dashboard and navigate to **API Keys** to get your key.

### Step 4: Select a Model

Once connected, open the model picker from the chat input bar. Type `llm` to filter LLM Gateway models — you'll see all available models including Claude Opus 4.7, Claude Sonnet 4.6, DeepSeek, Gemini, and more:

![LLM Gateway model selection](/images/guides/opencode-desktop/3-model-selection.png)

### Step 5: Start Building

Select a model and start chatting. All requests route through LLM Gateway — you'll see usage, costs, and logs in your [dashboard](/dashboard):

![OpenCode Desktop chat active with LLM Gateway](/images/guides/opencode-desktop/4-chat-active.png)

## Why Use LLM Gateway with OpenCode Desktop?

- **280+ models** — Claude, GPT, Gemini, Llama, DeepSeek, and more from 35+ providers
- **One API key** — Stop managing separate keys for each provider
- **Cost tracking** — See exactly what each session costs in your dashboard
- **Response caching** — Repeated requests hit cache automatically
- **Automatic fallback** — If a provider is down, requests route to an alternative
- **Volume discounts** — Check [discounted models](/models?discounted=true) for savings up to 90%

## Switching Models

You can switch models at any time from the model picker in the chat input bar. Click the current model name, type `llm` to filter to LLM Gateway models, and select a new one. The switch takes effect immediately for the next message.

## Troubleshooting

### LLM Gateway doesn't appear in provider list

Click **Show more providers** at the bottom of the Providers page to expand the full list, then search for "LLM".

### Authentication errors

Make sure your API key starts with `llmgtwy_` and is active. Check your [dashboard](/dashboard) to confirm the key is valid.

### Models not loading after connect

Try disconnecting and reconnecting the provider from Settings > Providers. If models still don't load, check your internet connection and verify the key is valid.
