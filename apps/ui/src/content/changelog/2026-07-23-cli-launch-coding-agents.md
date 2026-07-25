---
id: "68"
slug: "cli-launch-coding-agents"
date: "2026-07-23"
title: "Launch Any Coding Agent from the CLI"
summary: "The LLM Gateway CLI can now start any supported coding agent pre-wired to the gateway — Claude Code, OpenCode, Codex CLI, DevPass Code, and eight more. One command, one API key, 200+ models, and every request tracked in your dashboard."
image:
  src: "/changelog/cli-launch-coding-agents.png"
  alt: "A glowing terminal on a circuit board launching a fleet of coding agents, representing the LLM Gateway CLI's new launch command"
  width: 1536
  height: 1024
---

Every coding agent has its own idea of how to talk to a gateway: one wants env vars, another an `auth.json`, a third a TOML file, a fourth per-session flags. Wiring each one to LLM Gateway meant hunting through its docs first. **`llmgateway launch`** replaces all of that — one command that starts any supported coding agent with LLM Gateway configured out of the box.

## One command, any agent

```bash
# Interactive agent picker
npx @llmgateway/cli launch

# Launch a specific agent (shortcuts work too: `llmgateway claude`)
npx @llmgateway/cli launch claude
npx @llmgateway/cli launch opencode

# Pick a model — launcher flags go before the agent name
npx @llmgateway/cli launch -m gpt-5.5 claude

# Everything after the agent name is passed to the agent itself
npx @llmgateway/cli launch claude --continue

# See all supported agents and which are installed
npx @llmgateway/cli launch --list

# Inspect what would run without launching
npx @llmgateway/cli launch --dry-run codex
```

Twelve agents are supported at launch, each configured the way its own tooling expects:

| Agent         | Launch                    | Configuration                                          |
| ------------- | ------------------------- | ------------------------------------------------------ |
| DevPass Code  | `llmgateway devpass-code` | First-party agent — key refreshed in its `auth.json`   |
| Claude Code   | `llmgateway claude`       | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` env vars |
| OpenCode      | `llmgateway opencode`     | Built-in `llmgateway` provider                         |
| Empryo        | `llmgateway empryo`       | `empryo --set-key llmgateway`                          |
| SoulForge     | `llmgateway soulforge`    | `soulforge --set-key llmgateway`                       |
| Codex CLI     | `llmgateway codex`        | Per-session `-c` overrides (no config file changes)    |
| Autohand Code | `llmgateway autohand`     | `OPENAI_BASE_URL` + `OPENAI_API_KEY` env vars          |
| Pi            | `llmgateway pi`           | Provider added to `~/.pi/agent/models.json`            |
| Kimi Code     | `llmgateway kimi`         | Provider added to `~/.kimi-code/config.toml`           |
| MiMo Code     | `llmgateway mimo`         | Provider routed through the gateway in `mimocode.json` |
| OpenClaw      | `llmgateway openclaw`     | Provider added to `~/.openclaw/openclaw.json`          |
| Hermes Agent  | `llmgateway hermes`       | `hermes setup` run with gateway values on first launch |

Whichever agent you pick, requests flow through your LLM Gateway key — so model routing, fallback, cost tracking, and per-agent usage attribution all work exactly as they do everywhere else. If an agent isn't installed, the launcher prints its official install command instead of failing cryptically.

## Keys are verified before anything starts

The launcher resolves your API key from `--key`, the `LLMGATEWAY_API_KEY` environment variable, or the key stored by `llmgateway auth login --key` — in that order — and verifies it against the gateway before starting the agent. A stale key (say, one you rolled last week) is reported with its exact source, and the launcher falls back to the next valid one, prompting for a fresh key only if none works. No more launching an agent just to watch its first request 401.

Works with any LLM Gateway API key on every plan — PAYG credits and DevPass alike.

---

**[CLI documentation →](https://docs.llmgateway.io/guides/cli)** | **[Integration guides →](https://llmgateway.io/guides)**
