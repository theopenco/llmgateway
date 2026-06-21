---
id: hermes-agent
slug: hermes-agent
title: Hermes Agent Integration
description: Use any model with Hermes Agent through LLM Gateway. One config change, full cost tracking, 280+ models.
date: 2026-05-11
---

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is an open-source AI coding agent for your terminal built by Nous Research. It supports tool use, browser automation, multi-provider routing, skills, and MCP servers. By pointing it at LLM Gateway you get access to 280+ models from 35+ providers, all tracked in one dashboard.

One config change. No code changes. Full cost tracking.

## Prerequisites

- Hermes Agent installed — see installation below or visit the [Hermes Agent repo](https://github.com/nousresearch/hermes-agent)
- An LLM Gateway API key — [sign up free](https://llmgateway.io/signup) (no credit card required)

## Installation

Install Hermes Agent using the official install script:

```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```

After installation, reload your shell and verify:

```bash
source ~/.bashrc
hermes --version
```

> The installer handles Python 3.11, Node.js, ripgrep, and other dependencies automatically. See the [repo](https://github.com/nousresearch/hermes-agent) for Windows (PowerShell) and manual install options.

## Setup

### Step 1: Run the Setup Wizard

Run `hermes setup` to launch the interactive setup wizard. You can choose either **Quick setup** (option 1) for provider, model, and messaging configuration, or **Full setup** (option 2) to configure everything including tools, skills, and advanced options:

```bash
hermes setup
```

![Hermes Agent Setup Wizard](/images/guides/hermes-agent/0-setup-wizard.png)

In this guide we use Quick setup, but Full setup works the same way — it just includes additional configuration steps.

### Step 2: Configure Inference Provider

The wizard will ask you to configure your inference provider. Select **Custom OpenAI-compatible endpoint** and enter the LLM Gateway base URL:

```
API base URL: https://api.llmgateway.io/v1
```

Then paste your LLM Gateway API key (starts with `llmgtwy_`):

![Inference Provider Configuration](/images/guides/hermes-agent/1-inference-provider.png)

### Step 3: Choose a Model

The wizard presents a list of 280+ available models. Type a model name or select from the list. Popular choices include `claude-sonnet-4-6`, `gpt-5.5`, or `gemini-3.1-pro`:

![Model Selection List](/images/guides/hermes-agent/2-model-list.png)

### Step 4: Set Context Length

Leave the context length blank to auto-detect (recommended), or specify a custom value:

![Context Length Configuration](/images/guides/hermes-agent/3-context-length.png)

### Step 5: Set Display Name

Give your provider configuration a display name. This appears in the Hermes status bar when chatting:

![Display Name Configuration](/images/guides/hermes-agent/4-display-name.png)

### Step 6: Select Terminal Backend

Choose your terminal backend. In this guide we use **Local** (run directly on this machine), but you can pick any option based on your requirements — Docker for isolated containers, SSH for remote machines, Modal for serverless sandboxes, Daytona for cloud dev environments, and more:

![Terminal Backend Selection](/images/guides/hermes-agent/5-terminal-backend.png)

### Step 7: Setup Complete

Once done, Hermes shows you where your config files are stored and how to edit them. It will prompt **"Launch hermes chat now? [Y/n]"** — press `Y` to start an interactive agent session immediately:

![Setup Complete](/images/guides/hermes-agent/6-setup-complete.png)

Your configuration files:

- **Settings:** `~/.hermes/config.yaml`
- **API Keys:** `~/.hermes/.env`
- **Data:** `~/.hermes/cron/`, `sessions/`, `logs/`

Once you press `Y`, Hermes launches a full agent session connected to LLM Gateway. You can start chatting right away.

## Using Hermes with LLM Gateway

Once configured, all requests route through LLM Gateway. You'll see the provider name (e.g., "LLMGATEWAY") in the Hermes status bar.

### Switching Models at Runtime

You can switch models mid-session using the `/model` slash command (similar to how Claude Code uses slash commands). Just type `/model` followed by the model name:

![Switching to Claude Haiku via LLM Gateway](/images/guides/hermes-agent/7-chat-claude.png)

Switch to any model available through LLM Gateway — from Claude to GPT to open-source models — without leaving your session:

![Switching to GPT-5.4-nano via LLM Gateway](/images/guides/hermes-agent/8-chat-gpt.png)

Add `--global` to persist the model change across sessions.

### CLI Model Override

You can also override the model from the command line:

```bash
# Use a specific model for this session
hermes chat --model gpt-5.5

# Use a powerful model for complex tasks
hermes chat --model claude-opus-4-6
```

## Why Use LLM Gateway with Hermes Agent

- **280+ models** — Claude, GPT, Gemini, Llama, DeepSeek, and more
- **One API key** — Stop managing separate keys for each provider
- **Cost tracking** — See exactly what each session costs in your dashboard
- **Response caching** — Repeated requests hit cache automatically
- **Automatic fallback** — If a provider is down, requests route to an alternative
- **Volume discounts** — Check [discounted models](https://llmgateway.io/models?discounted=true) for savings up to 90%

## One-Shot Mode

For scripting or CI pipelines, use the `-q` flag for a one-shot prompt:

```bash
hermes chat -q "Explain what this function does" -Q
```

The `-Q` flag enables quiet mode, suppressing the banner and spinner for clean output. For pure one-shot mode (no interactive session):

```bash
hermes chat -z "Generate a README for this project"
```

## Useful Hermes Commands

| Command                | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `hermes`               | Start interactive chat (default)        |
| `hermes setup`         | Run the setup wizard                    |
| `hermes setup model`   | Change model/provider                   |
| `hermes chat -q "..."` | One-shot prompt                         |
| `hermes model`         | Choose provider and model interactively |
| `hermes config edit`   | Open config in your editor              |
| `hermes doctor`        | Diagnose connection/config issues       |
| `hermes sessions`      | Browse and manage past sessions         |
| `hermes --continue`    | Resume most recent session              |
| `hermes update`        | Update to latest version                |

## Locking to a Specific Provider

By default, LLM Gateway automatically fails over to alternative providers if your chosen provider is experiencing downtime. To disable fallback and always route to one provider, add the header via Hermes's request configuration.

> Disabling fallback means requests will fail if the chosen provider is down. See the [routing docs](https://docs.llmgateway.io/features/routing) for details.

## Troubleshooting

### Model not found

If you get a "model not supported" error, check that your model ID matches exactly what's listed on the [models page](https://llmgateway.io/models). Model IDs are case-sensitive.

### Connection timeout

Verify your `base_url` is set to `https://api.llmgateway.io/v1` (note the `/v1` at the end). You can also check the `HERMES_API_TIMEOUT` environment variable if you're hitting timeouts on long-running requests.

### Authentication errors

Make sure your `api_key` starts with `llmgtwy_` and is valid. Check your [dashboard](/dashboard) to confirm the key is active.

### Diagnosing issues

Run `hermes doctor` to check your configuration, connectivity, and credentials:

```bash
hermes doctor
```

### Old config overrides

If you previously used a different provider (e.g., OpenRouter), make sure to update both `provider` and `base_url` fields. The `provider` must be set to `"custom"` for LLM Gateway. Also check `~/.hermes/.env` for any leftover `OPENROUTER_API_KEY` or other provider keys that might take precedence.

## Get Started

Ready to run Hermes Agent on any model? [Sign up for LLM Gateway](https://llmgateway.io/signup) and grab your API key.

Questions? Check [our docs](https://docs.llmgateway.io) or [join Discord](https://llmgateway.io/discord).
