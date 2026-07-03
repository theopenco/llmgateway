---
id: devpass-code
slug: devpass-code
title: DevPass Code Integration
description: Set up DevPass Code, the open-source terminal coding agent built for LLM Gateway. Install from npm, log in once from your browser, and code with every model on the gateway.
date: 2026-07-03
---

DevPass Code is an open-source terminal coding agent that talks only to LLM Gateway. It's a fork of opencode (MIT) trimmed down to a single upstream: one browser login, roughly 190 text models, and no per-provider API keys to juggle. Every request is tagged with `x-source: devpass-code`, so usage is attributed correctly in your dashboard and on your DevPass plan.

## Install

Install DevPass Code globally from npm:

```bash
npm i -g devpass-code
```

Or with Homebrew:

```bash
brew install theopenco/tap/devpass-code
```

Other options: an install script (`curl -fsSL https://raw.githubusercontent.com/theopenco/devpass-code/main/install | bash`), an AUR package (`devpass-code-bin`), a Docker image (`ghcr.io/theopenco/devpass-code`), and Windows binaries on [GitHub releases](https://github.com/theopenco/devpass-code/releases).

## Setup

### Step 1: Start the login flow

DevPass Code supports one-click browser login, just like Claude Code:

```bash
devpass-code auth login
```

### Step 2: Pick a provider

Choose how your usage is billed. Both providers hit `https://api.llmgateway.io/v1` and expose the same models:

| Provider                | Billing                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| **LLM Gateway**         | Pay-as-you-go with credits or your own API key                              |
| **LLM Gateway DevPass** | The [DevPass](/code) coding subscription — billing is handled automatically |

### Step 3: Log in with your browser

Select **"Log in with browser."** DevPass Code opens [llmgateway.io/connect/cli](https://llmgateway.io/connect/cli) and starts a local loopback server. Approve the request in the browser, and the API key is delivered straight back to your machine — nothing to copy or paste. Credentials are saved to `~/.local/share/devpass-code/auth.json`.

Prefer to paste a key? Choose **"Paste an API key"** instead and use a key from your [dashboard](https://llmgateway.io/dashboard), or set the `LLMGATEWAY_API_KEY` environment variable to skip the prompt entirely.

### Step 4: Start coding

Launch the TUI in any project directory:

```bash
devpass-code
```

Every text model on the gateway shows up in the model picker, and switching is a keystroke — no config change. All requests and their costs appear in your [dashboard](https://llmgateway.io/dashboard).

## Configuration

- **Config file** — Place a `devpass-code.json` in your project (or global config directory) to customize models and behavior.
- **`LLMGATEWAY_API_KEY`** — Provide your LLM Gateway API key without running the login flow.
- **`DEVPASS_APP_URL`** — Override the app URL used for browser login (defaults to `https://llmgateway.io`).

## Why Use DevPass Code

- **~190 text models** — Claude, GPT, Gemini, Grok, DeepSeek, and more, all through one endpoint
- **One-click login** — Approve in the browser, key delivered automatically
- **DevPass billing** — A [DevPass subscription](/code) is applied automatically, with usage attributed per agent
- **Cost tracking** — See exactly what each coding session costs
- **Open source** — MIT licensed, on [GitHub](https://github.com/theopenco/devpass-code)

Read the [announcement post](/blog/devpass-code) for the full story, or the [docs guide](https://docs.llmgateway.io/guides/devpass-code) for reference details.
