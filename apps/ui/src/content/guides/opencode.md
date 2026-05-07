---
id: opencode
slug: opencode
title: OpenCode Integration
description: Connect OpenCode to 210+ models through LLM Gateway's built-in provider. No config files needed — just select, authenticate, and code.
date: 2026-01-09
---

OpenCode is an open-source AI coding agent for your terminal, IDE, or desktop. LLM Gateway is a built-in provider in OpenCode, so setup takes under a minute — no config files or npm adapters required. You get access to 210+ models from 60+ providers, all tracked in one dashboard.

## Prerequisites

Before starting, you need to install OpenCode. Visit the [OpenCode download page](https://opencode.ai/download) to install OpenCode for your platform (Windows, macOS, or Linux).

After installation, verify it works by running:

```bash
opencode --version
```

## Setup

### Step 1: Launch OpenCode

Start OpenCode from your terminal:

```bash
opencode
```

**In VS Code/Cursor:**

1. Install the OpenCode extension from the marketplace
2. Open Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
3. Type "OpenCode" and select "Open opencode"

### Step 2: Open the Provider List

Once OpenCode launches, run the `/providers` or `/connect` command to open the provider selection screen:

![OpenCode Connect Command](/images/guides/opencode/connect-command.png)

### Step 3: Select LLM Gateway

LLM Gateway is listed as a built-in provider. Select "LLM Gateway" from the provider list:

![Select LLM Gateway Provider](/images/guides/opencode/select-provider.png)

### Step 4: Enter Your API Key

OpenCode will prompt you for your API key. Enter your LLM Gateway API key and press Enter:

![Enter API Key](/images/guides/opencode/enter-api-key.png)

OpenCode will automatically save your credentials securely.

**Where to get your API key:**

[Sign up for LLM Gateway](/signup) and create an API key from your dashboard.

### Step 5: Start Using OpenCode

You're all set! OpenCode is now connected to LLM Gateway. You can start asking questions and building with AI:

![OpenCode Ready](/images/guides/opencode/ready-to-use.png)

Try asking OpenCode about your project or request help with coding tasks:

![OpenCode in Action](/images/guides/opencode/opencode-usage.png)

## Why Use LLM Gateway with OpenCode?

- **210+ models** — GPT-5, Claude, Gemini, Llama, and more from 60+ providers
- **One API key** — Stop juggling credentials for every provider
- **Cost tracking** — See what each coding session costs in your dashboard
- **Response caching** — Repeated requests hit cache automatically
- **Volume discounts** — The more you use, the more you save

## Adding Custom Models

The built-in provider gives you access to all standard LLM Gateway models. If you want to add custom model aliases or configure models not yet listed in the built-in provider, you can create a `config.json` in your OpenCode configuration directory:

**macOS/Linux:** `~/.config/opencode/config.json`

**Windows:** `C:\Users\YourUsername\.config\opencode\config.json`

```json
{
  "provider": {
    "llmgateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LLM Gateway",
      "options": {
        "baseURL": "https://api.llmgateway.io/v1"
      },
      "models": {
        "deepseek/deepseek-chat": {
          "name": "DeepSeek Chat"
        },
        "meta/llama-3.3-70b": {
          "name": "Llama 3.3 70B"
        }
      }
    }
  }
}
```

After updating `config.json`, restart OpenCode to see the new models.

## Switching Models

Select a different model directly in the OpenCode interface, or update the `model` field in your configuration:

```json
{
  "model": "llmgateway/gpt-5-mini"
}
```

## Troubleshooting

### Connection timeout

Check that you have an active internet connection and that your API key is valid from the [dashboard](/dashboard).

### Custom models not showing up

After editing `config.json`, restart OpenCode completely for changes to take effect.

### 404 Not Found errors with custom config

If you are using a custom `config.json`, verify your `baseURL` is set to `https://api.llmgateway.io/v1` (note the `/v1` at the end).

## Configuration Tips

- **Global configuration**: Use `~/.config/opencode/config.json` to apply settings across all projects
- **Project-specific**: Place `opencode.json` in your project root to override global settings for that project
- **Model selection**: You can specify different models for different types of tasks using OpenCode's agent configuration

## Get Started

Ready to enhance your OpenCode experience? [Sign up for LLM Gateway](/signup) and get your API key today.
