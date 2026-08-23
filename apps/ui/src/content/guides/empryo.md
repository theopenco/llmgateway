---
id: empryo
slug: empryo
title: Empryo Integration
seoTitle: Use Empryo with LLM Gateway — one login, every model
description: Set up Empryo, the graph-powered AI coding agent, with LLM Gateway. One browser login connects the terminal UI, desktop app, and headless CLI to every model on the gateway.
date: 2026-08-24
---

Empryo is a graph-powered AI coding agent from [empryo.com](https://empryo.com) — it parses your codebase into a code-intelligence graph and edits symbols, not strings. It ships as a terminal UI, a desktop app, and a headless CLI on macOS, Linux, and Windows, and LLM Gateway is built in: one browser login connects all ~190 text models on the gateway, and every request is tagged with `x-source: empryo` so usage is attributed correctly in your dashboard and on your DevPass plan.

> **On a DevPass plan?** Log in with `/login llmgateway-devpass` and use canonical model IDs (`claude-opus-5`, not `anthropic/claude-opus-5`) — provider-pinned routing is not available on coding plans; the gateway picks the provider for you.

## Install

macOS / Linux:

```bash
curl -fsSL https://empryo.com/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://empryo.com/install.ps1 | iex
```

Both installers verify checksums before running anything. Direct binaries and the desktop app are on the [download page](https://empryo.com/download).

## Setup

### Step 1: Launch Empryo

Start Empryo in any project directory:

```bash
empryo
```

### Step 2: Log in with your browser

Type `/login`. Empryo opens [llmgateway.io/connect/cli](https://llmgateway.io/connect/cli) and starts a local loopback server — approve the connection in the browser and the minted API key is delivered straight back to Empryo. Nothing to copy or paste. On a DevPass coding subscription, run `/login llmgateway-devpass` instead.

Prefer to paste a key? Use `/keys` inside the TUI, run `empryo --set-key llmgateway <key>` from a shell, or set the `LLM_GATEWAY_API_KEY` environment variable.

### Step 3: Pick a model

Open the model picker with `/models`. LLM Gateway's models are grouped by upstream provider, with live pricing, context windows, and output limits pulled from the gateway's own catalog — what you see is what you're billed.

### Step 4: Start coding

Every prompt and its cost appears in your [dashboard](https://llmgateway.io/dashboard), attributed to Empryo. On a DevPass key, Empryo also renders your plan meters — monthly credits and the weekly premium window — as a footer badge in the TUI and in the desktop usage drawer, next to Empryo's own local usage ledger (`/usage`).

## One connection, three surfaces

The gateway connection is shared by everything Empryo ships. The desktop app runs the same browser login (from onboarding or the keys drawer) and the same grouped model picker, and the headless CLI takes the same credentials for scripts and CI:

```bash
empryo --headless "fix the failing test" --model llmgateway/claude-opus-5
```

Claude models take the gateway's Anthropic-native endpoint, so extended thinking and prompt caching survive the hop; everything else rides the OpenAI-compatible API.

## Why use Empryo with LLM Gateway

- **~190 text models** — Claude, GPT, Gemini, Grok, DeepSeek, and more through one login
- **Live pricing in the picker** — rates, context, and output caps come from the gateway's catalog, not a stale copy
- **Native Anthropic wire for Claude** — thinking and prompt caching intact
- **Attribution built in** — the dashboard shows exactly what the agent spent
- **DevPass aware** — plan meters render inside Empryo, billing is handled by the gateway

Read the [docs guide](https://docs.llmgateway.io/guides/empryo) for routing details and troubleshooting, or Empryo's own documentation at [empryo.com/docs](https://empryo.com/docs).
