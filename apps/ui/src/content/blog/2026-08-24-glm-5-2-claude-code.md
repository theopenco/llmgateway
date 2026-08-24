---
id: "blog-glm-5-2-claude-code"
slug: "glm-5-2-claude-code"
date: "2026-08-24"
title: "How to Use GLM-5.2 with Claude Code, Cursor, and Cline"
summary: "GLM-5.2 in Claude Code takes three environment variables. This guide walks through the exact setup for Claude Code, Cursor, and Cline via LLM Gateway — plus why GLM-5.2 is the rare open coder that's uncapped on a flat-rate DevPass plan."
categories: ["Guides", "Integrations"]
model: glm-5.2
faqs:
  - question: "Does Claude Code work with GLM-5.2?"
    answer: "Yes. Claude Code sends Anthropic-format requests to whatever `ANTHROPIC_BASE_URL` points at. LLM Gateway accepts that format and translates it for each provider, so `ANTHROPIC_MODEL=glm-5.2` just works — with the model's full 1M-token context and reasoning support."
  - question: "Is GLM-5.2 a premium-tier model on DevPass?"
    answer: "No — and that's the point. Premium tiering starts at $15 per million output tokens; GLM-5.2's $4.40/M output keeps it standard tier, so it has no weekly allowance cap. It draws only from your monthly credit pool, which makes it the natural bulk-loop model on any DevPass plan."
  - question: "GLM-5.2 or Kimi K3 for coding?"
    answer: "Both carry a 1M context. Kimi K3 is the stronger pick for the hardest reasoning problems but costs $15/M output and sits in DevPass's capped premium tier. GLM-5.2 is roughly 3.4× cheaper on output and uncapped weekly. The pattern most developers land on: GLM-5.2 for the bulk of the agent loop, K3 or a frontier model for the problems that resist it."
  - question: "How is this different from the Z.ai GLM Coding Plan?"
    answer: "Z.ai's own plan is the cheapest way to run GLM models exclusively — one vendor, one model family. Running GLM-5.2 through LLM Gateway costs more but puts the same model next to 200+ others under one key, with automatic failover across a dozen upstream providers when one has a bad day."
image:
  src: "/blog/glm-5-2-claude-code.png"
  alt: "Circuit board with cables plugging coding tool icons into a central glowing chip, representing GLM-5.2 connected to Claude Code, Cursor, and Cline"
  width: 1536
  height: 1024
---

GLM-5.2 has quietly become the workhorse of the open-coder wave: Zhipu's flagship for long-horizon agentic engineering, a 1M-token context, reasoning support, and output priced at $4.40 per million tokens — a fraction of frontier rates. It anchors [Z.ai's own coding plan](https://devpass.llmgateway.io/compare/z-ai-glm-coding-plan) and sits in the uncapped tier of [OpenCode Go's catalog](/blog/opencode-go-pricing). But Zhipu doesn't ship a coding agent, and your coding agent doesn't ship GLM-5.2.

**LLM Gateway** bridges that gap. It speaks both the Anthropic and OpenAI API formats, so the tools you already use can run GLM-5.2 — or any of [200+ models](https://llmgateway.io/models) — with a base-URL change. Here is the exact setup for each tool.

## GLM-5.2 in Claude Code

Claude Code talks to any endpoint that speaks Anthropic's `/v1/messages` format, which LLM Gateway does natively. Three environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=glm-5.2

claude
```

That's the whole migration. Every request now routes through LLM Gateway to GLM-5.2, and every request shows up in your dashboard with its exact cost, token counts, and cache-hit rate.

One refinement worth adding: Claude Code uses a second, smaller model for routine background work, and you can point it at something free:

```bash
export ANTHROPIC_SMALL_FAST_MODEL=glm-4.7-flash-free
```

That keeps the whole session in the GLM family — 5.2 on the real work, a $0 model on the housekeeping.

## GLM-5.2 in Cursor

Cursor routes its **AI panel** (Cmd/Ctrl + L) — both plan mode and agent mode — through a custom OpenAI-compatible endpoint. Setup:

1. Open **Cursor Settings → Models**
2. Add your LLM Gateway key under **OpenAI API Key**
3. Enable **Override OpenAI Base URL** and set it to `https://api.llmgateway.io/v1`
4. Add `glm-5.2` as a custom model and select it

Be aware of the boundary: Cursor's inline edit (Cmd/Ctrl + K) and tab autocomplete are locked to Cursor's own backend and will not route through any external endpoint. Plan, chat, and run agent tasks on GLM-5.2's full 1M context in Cursor; for a complete agent loop on it, use Claude Code or Cline instead.

<BlogCta variant="devpass" location="mid_article" />

## GLM-5.2 in Cline

Cline is the straightforward one — it's built to bring your own key:

1. Open the Cline panel in VS Code and click the settings gear
2. Set **API Provider** to **OpenAI Compatible**
3. **Base URL**: `https://api.llmgateway.io/v1`
4. **API Key**: your LLM Gateway key
5. **Model ID**: `glm-5.2`

Cline's full agent loop — file edits, terminal commands, project scaffolding — now runs on GLM-5.2. If you want Zhipu's own deployment specifically, use `zai/glm-5.2`; otherwise the gateway picks a healthy provider from the dozen that serve the model and fails over automatically.

Also worth knowing: [OpenCode ships LLM Gateway as a built-in provider](/blog/opencode-built-in-provider), so there GLM-5.2 is a login and a model pick, no URLs at all.

## What GLM-5.2 costs in your coding agent

Agent loops are token-hungry, which is exactly the case [DevPass](https://devpass.llmgateway.io) was built for — a flat monthly rate instead of a per-token bill:

| Plan    | Price      | Model usage included   |
| ------- | ---------- | ---------------------- |
| Lite    | $29/mo     | ~$87 at provider rates |
| **Pro** | **$79/mo** | **~$237**              |
| Max     | $179/mo    | ~$537                  |

Here's what makes GLM-5.2 special on DevPass: it's a **standard-tier model**, so unlike Kimi K3 or the frontier flagships it has **no weekly allowance cap** — it draws only from your monthly credit pool. At GLM-5.2's rates ($1.40/M input, $0.26/M cached input, $4.40/M output), a heavy agent session — a few million tokens in, most of them cache hits — lands around $2. The Pro allowance covers over a hundred of those a month, and the cached-input rate is what makes the math work: agent loops re-send the same context every step, and cache hits bill at less than a fifth of the fresh rate.

The pattern most developers settle into: GLM-5.2 for the bulk of the loop, and a premium model — [Kimi K3](/blog/kimi-k3-claude-code), Claude Opus 5 — for the planning passes and the bugs that resist it. Same key, same session, one model switch.

Prefer straight metering? Pay-as-you-go credits work with the identical setup: top up from $10 and pay the published rates plus a 5% platform fee at top-up.

## Getting started

- **[Get DevPass](https://devpass.llmgateway.io)** — flat-rate GLM-5.2 in your coding agent from $29/mo, uncapped within your allowance
- **[Try LLM Gateway free](https://llmgateway.io/signup)** — one key for GLM-5.2 and 200+ models
- Weighing plans? See where GLM-anchored plans rank in the [best AI coding plans in 2026](/blog/best-ai-coding-plans)
- Requests failing? Check the live [GLM-5.2 status page](/models/glm-5.2/uptime) for per-provider uptime before you debug your setup

<BlogCta variant="devpass" location="bottom" />
