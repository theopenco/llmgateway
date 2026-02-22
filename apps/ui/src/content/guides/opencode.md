---
id: opencode
slug: opencode
title: OpenCode Integration
description: Connect OpenCode to 180+ models through LLM Gateway. One config file, any model, full cost tracking.
date: 2026-01-09
---

OpenCode is an open-source AI coding agent for your terminal, IDE, or desktop. This guide shows you how to connect it to LLM Gateway—giving you access to 180+ models from 60+ providers, all tracked in one dashboard.

## Prerequisites

Before starting, you need to install OpenCode. Visit the [OpenCode download page](https://opencode.ai/download) to install OpenCode for your platform (Windows, macOS, or Linux).

After installation, verify it works by running:

```bash
opencode --version
```

## Configuration Steps

Setting up OpenCode with LLM Gateway requires creating a configuration file and connecting your API key.

### Step 1: Create Configuration File

Create a file named `config.json` in the OpenCode configuration directory:

**Location:**

Windows:

```
C:\Users\YourUsername\.config\opencode\config.json
```

macOS/Linux:

```
~/.config/opencode/config.json
```

**File contents:**

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
        "gpt-5": {
          "name": "GPT-5"
        },
        "gpt-5-mini": {
          "name": "GPT-5 Mini"
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro"
        },
        "claude-3-5-sonnet-20241022": {
          "name": "Claude 3.5 Sonnet"
        }
      }
    }
  },
  "model": "llmgateway/gpt-5"
}
```

**Configuration explained:**

- **npm**: The adapter package OpenCode uses to communicate with OpenAI-compatible APIs
- **baseURL**: LLM Gateway's API endpoint
- **models**: The models you want to use (you can add more from our [models page](https://llmgateway.io/models))
- **model**: Your default model selection

### Step 2: Launch OpenCode and Connect Provider

Start OpenCode from your terminal:

```bash
opencode
```

**In VS Code/Cursor:**

1. Install the OpenCode extension from the marketplace
2. Open Command Palette (Ctrl+Shift+P or Cmd+Shift+P)
3. Type "OpenCode" and select "Open opencode"

Once OpenCode launches, run the `/connect` command to connect to LLM Gateway:

![OpenCode Connect Command](/images/guides/opencode/connect-command.png)

### Step 3: Select LLM Gateway Provider

In the provider list, scroll down to find "LLM Gateway" under the "Other" section and select it:

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

- **180+ models** — GPT-5, Claude, Gemini, Llama, and more from 60+ providers
- **One API key** — Stop juggling credentials for every provider
- **Cost tracking** — See what each coding session costs in your dashboard
- **Response caching** — Repeated requests hit cache automatically
- **Volume discounts** — The more you use, the more you save

## Adding More Models

You can add any model from the [models page](https://llmgateway.io/models) to your configuration. Simply add more entries to the `models` object in your `config.json`:

```json
{
  "provider": {
    "llmgateway": {
      "models": {
        "gpt-5": { "name": "GPT-5" },
        "gpt-5-mini": { "name": "GPT-5 Mini" },
        "deepseek/deepseek-chat": { "name": "DeepSeek Chat" },
        "meta/llama-3.3-70b": { "name": "Llama 3.3 70B" }
      }
    }
  }
}
```

After updating `config.json`, restart OpenCode to see the new models.

## Switching Models

To change your default model, update the `model` field in your configuration:

```json
{
  "model": "llmgateway/gpt-5-mini"
}
```

Or select a different model directly in the OpenCode interface.

## Troubleshooting

### OpenCode asks for API key every time

Make sure the provider ID in your `config.json` matches exactly: `"llmgateway"` (all lowercase, no spaces).

### 404 Not Found errors

Verify your `baseURL` is set to `https://api.llmgateway.io/v1` (note the `/v1` at the end).

### Models not showing up

After editing `config.json`, restart OpenCode completely for changes to take effect.

### Connection timeout

Check that you have an active internet connection and that your API key is valid from the [dashboard](/dashboard).

## Configuration Tips

- **Global configuration**: Use `~/.config/opencode/config.json` to apply settings across all projects
- **Project-specific**: Place `opencode.json` in your project root to override global settings for that project
- **Model selection**: You can specify different models for different types of tasks using OpenCode's agent configuration

## Get Started

Ready to enhance your OpenCode experience? [Sign up for LLM Gateway](/signup) and get your API key today.
