---
id: "blog-kimi-k3-claude-code"
slug: "kimi-k3-claude-code"
date: "2026-07-19"
title: "How to Use Kimi K3 with Claude Code, Cursor, and Cline"
summary: "Kimi K3 in Claude Code takes three environment variables. This guide walks through the exact setup for Claude Code, Cursor, and Cline via LLM Gateway — plus what each tool does and doesn't route, and what K3 costs on a flat-rate DevPass plan."
categories: ["Guides", "Integrations"]
image:
  src: "/blog/kimi-k3-claude-code.png"
  alt: "Circuit board with cables plugging coding tool icons into a central glowing chip, representing Kimi K3 connected to Claude Code, Cursor, and Cline"
  width: 1536
  height: 1024
---

Kimi K3 took first place in Arena's Frontend Code evaluation the week it launched, and it holds a 1M-token context — but Moonshot doesn't ship a coding agent, and your coding agent doesn't ship Kimi K3. Claude Code is locked to Anthropic's API by default, Cursor to its own backend, Cline to whatever key you hand it.

**LLM Gateway** bridges that gap. It speaks both the Anthropic and OpenAI API formats, so the tools you already use can run Kimi K3 — or any of [200+ models](https://llmgateway.io/models) — with a base-URL change. Here is the exact setup for each tool.

## Kimi K3 in Claude Code

Claude Code talks to any endpoint that speaks Anthropic's `/v1/messages` format, which LLM Gateway does natively. Three environment variables:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=kimi-k3

claude
```

That's the whole migration. Every request now routes through LLM Gateway to Kimi K3, and every request shows up in your dashboard with its exact cost, token counts, and cache-hit rate.

One refinement worth adding: Claude Code uses a second, smaller model for routine background work, and you can point it at something cheap — or free:

```bash
export ANTHROPIC_SMALL_FAST_MODEL=glm-4.7-flash-free
```

That puts K3 on the hard reasoning and a $0 model on the housekeeping.

## Kimi K3 in Cursor

Cursor routes its **AI panel** (Cmd/Ctrl + L) — both plan mode and agent mode — through a custom OpenAI-compatible endpoint. Setup:

1. Open **Cursor Settings → Models**
2. Add your LLM Gateway key under **OpenAI API Key**
3. Enable **Override OpenAI Base URL** and set it to `https://api.llmgateway.io/v1`
4. Add `kimi-k3` as a custom model and select it

Be aware of the boundary: Cursor's inline edit (Cmd/Ctrl + K) and tab autocomplete are locked to Cursor's own backend and will not route through any external endpoint. Plan, chat, and run agent tasks with K3's full 1M context in Cursor; for completions and inline edits on K3, use Claude Code or Cline instead.

## Kimi K3 in Cline

Cline is the straightforward one — it's built to bring your own key:

1. Open the Cline panel in VS Code and click the settings gear
2. Set **API Provider** to **OpenAI Compatible**
3. **Base URL**: `https://api.llmgateway.io/v1`
4. **API Key**: your LLM Gateway key
5. **Model ID**: `kimi-k3`

Cline's full agent loop — file edits, terminal commands, project scaffolding — now runs on K3. If you want a specific upstream, use `moonshot/kimi-k3`; otherwise the gateway picks a healthy provider and fails over automatically.

Also worth knowing: [OpenCode ships LLM Gateway as a built-in provider](/blog/opencode-built-in-provider), so there K3 is a login and a model pick, no URLs at all.

## What Kimi K3 costs in your coding agent

Agent loops are token-hungry, which is exactly the case [DevPass](https://devpass.llmgateway.io) was built for — a flat monthly rate instead of a per-token bill:

| Plan    | Price      | Model usage included   |
| ------- | ---------- | ---------------------- |
| Lite    | $29/mo     | ~$87 at provider rates |
| **Pro** | **$79/mo** | **~$237**              |
| Max     | $179/mo    | ~$537                  |

Kimi K3 is a **premium-tier model** on DevPass (it crosses the $15-per-million-output threshold), so it draws from a weekly premium allowance — roughly $10 per week on Lite, $36 on Pro, $97 on Max. The practical pattern: K3 for planning and the gnarly bugs, a standard-tier model like GLM-5.2 or DeepSeek V4 Pro for the bulk of the loop — both uncapped within your monthly allowance. Pro and Max include one and two Reset Passes per cycle if you burn the premium allowance early.

Prefer straight metering? Pay-as-you-go credits work with the identical setup: top up from $10, pay Moonshot's published rates ($3.00/M input, $0.30/M cached, $15.00/M output) plus a 5% platform fee at top-up. K3's cached-input pricing matters here — agent loops re-send the same context every step, and cache hits bill at a tenth of the fresh rate.

## Frequently Asked Questions

### Does Claude Code work with non-Anthropic models like Kimi K3?

Yes. Claude Code sends Anthropic-format requests to whatever `ANTHROPIC_BASE_URL` points at. LLM Gateway accepts that format and translates to each provider behind the scenes, so `ANTHROPIC_MODEL=kimi-k3` just works — as does any other model in the catalog.

### Can Cursor's Composer or autocomplete use Kimi K3?

No. Cursor only honors a custom endpoint for the chat / plan panel; Composer, inline edit, and autocomplete stay on Cursor's backend regardless of your settings. For a full agent loop on K3, use Claude Code, Cline, or OpenCode.

### Is Kimi K3 included in DevPass?

Yes, on every tier, as a premium-tier model with a weekly allowance on top of your monthly credit pool. Standard-tier models — including GLM-5.2 and DeepSeek V4 Pro — have no weekly cap.

### Which coding tool is best for Kimi K3?

The ones that route their full agent loop through your endpoint: Claude Code, Cline, or OpenCode. Cursor is fine for K3-powered planning but keeps its agent features on its own models.

## Getting started

- **[Get DevPass](https://devpass.llmgateway.io)** — flat-rate Kimi K3 in your coding agent from $29/mo
- **[Try LLM Gateway free](https://llmgateway.io/signup)** — one key for K3 and 200+ models
- New to K3? Start with [Kimi K3 and China's Open-Weight Model Wave](/blog/kimi-k3), or see how it stacks up in [Kimi K3 vs Claude Opus 4.8](/blog/kimi-k3-vs-claude-opus)
