---
id: "blog-devpass-code-smart-router"
slug: "devpass-code-smart-router"
date: "2026-10-15"
title: "DevPass Code 2.0: A Smart Router That Picks the Model for Every Turn"
summary: "DevPass Code 2.0 adds the Smart Router: before each message, an LLM Gateway decision model reads your request and sends it to Claude Haiku, Sonnet or Opus. You choose the decision model, GPT-6 Luna Decisions, Microsoft-Decision-1 or Jev, and session tabs let you run several agents side by side."
categories: ["Announcements", "Product"]
faqs:
  - question: "What is the DevPass Code Smart Router?"
    answer: "A model option in DevPass Code that picks the model for each message you send. Before the turn starts, an LLM Gateway decision model reads your request and chooses a tier: fast (`claude-haiku-5-5`), balanced (`claude-sonnet-5-5`) or frontier (`claude-opus-5-5`). It is the default model in DevPass Code 2.0."
  - question: "Which decision models can the Smart Router use?"
    answer: "Every model LLM Gateway serves on `/v1/decisions`: `jev-1.13.0` (the default), `microsoft-decision-1` and `gpt-6-luna-decisions`. Pick one with the `/smart-router` command, or cycle through them with `ctrl+t`."
  - question: "How much does a Smart Router decision cost?"
    answer: "A decision reads at most the last 8,000 characters of your latest message, around 2,000 tokens. Jev and Microsoft-Decision-1 cost $0.042 per million input tokens, so a decision costs under $0.0001. GPT-6 Luna Decisions costs $0.10 per million, about $0.0002 per decision. Decision models have no output charge."
  - question: "Can I change the models behind each tier?"
    answer: "Yes. Set `DEVPASS_SMART_ROUTER_MODELS=fast,balanced,frontier` to any three LLM Gateway model IDs, and `DEVPASS_SMART_ROUTER_DECISION_MODEL` to change the default decision model."
  - question: "Does the Smart Router work with a DevPass subscription?"
    answer: "Yes. It is available on both providers in DevPass Code: **LLM Gateway** for pay-as-you-go credits and **LLM Gateway DevPass** for DevPass subscribers."
image:
  src: "/blog/devpass-code-smart-router.png"
  alt: "A beam of light on a central chip splitting into three paths toward small, medium and large pedestals, surrounded by a terminal, stacked tabs, a gauge and a lightning bolt, representing the DevPass Code Smart Router picking a model tier"
  width: 1536
  height: 1024
---

A coding agent runs every message on whichever model you picked when the session started. Ask Claude Opus what a function does and you pay frontier prices for a lookup. Leave Claude Haiku on for a three-file refactor and it takes longer and gets more wrong. Switching models by hand every few messages is the kind of busywork a coding agent is supposed to remove.

**DevPass Code 2.0** ships the **Smart Router**. Before each message, an LLM Gateway decision model reads your request and picks the cheapest model tier that will do the job well. You choose which decision model makes that call. The release also brings session tabs from opencode v2, so you can run several agents side by side.

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/dYRPOwLP8V4"
		title="DevPass Code: Smart Router, decision models and tabs"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## How the Smart Router picks a model

Smart Router is the default model in DevPass Code 2.0. Each time you send a message, DevPass Code passes it to LLM Gateway's [Decisions API](https://docs.llmgateway.io/features/decisions) with one question: which tier should handle this?

| Tier     | Model               | Used for                                                                       | Price per 1M tokens (input / output) |
| -------- | ------------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| fast     | `claude-haiku-5-5`  | Questions, explanations, lookups, small single-file edits, simple commands     | $0.10 / $0.50 (up to 100K input)     |
| balanced | `claude-sonnet-5-5` | Typical multi-step coding: features, bug fixes, tests across a few files       | $2 / $10                             |
| frontier | `claude-opus-5-5`   | Large refactors, deep debugging, architecture, subtle concurrency and security | $4 / $20                             |

The answer comes back as a choice with a probability, not generated text, so the decision takes one short request. A few rules keep it predictable:

- **One decision per message.** Every tool call inside that turn stays on the same model, so the provider's prompt cache keeps working.
- **Housekeeping stays cheap.** Session titles and context compaction always run on the fast tier.
- **Failures fall back to balanced.** If the decision call fails, the turn goes to `claude-sonnet-5-5` instead of stopping.
- **Picking a model turns it off.** Choose any other model from the picker, or set one in your config, and DevPass Code uses that model for every turn.

## Choose who makes the decision

The decision model is yours to pick. DevPass Code offers every model LLM Gateway serves on [`/v1/decisions`](/models?filters=1&decisions=true):

| Decision model         | Input price per 1M tokens | Context | Notes                                      |
| ---------------------- | ------------------------- | ------- | ------------------------------------------ |
| `jev-1.13.0`           | $0.042                    | 64K     | The default, from TypeSafe AI              |
| `microsoft-decision-1` | $0.042                    | 32K     | Microsoft's small decision model, on Azure |
| `gpt-6-luna-decisions` | $0.10                     | 1.05M   | GPT-6 Luna through OpenAI's Decisions API  |

Run `/smart-router` to open the picker, or press `ctrl+t` to cycle through the decision models. Decision models only charge for input, and a decision reads at most the last 8,000 characters of your message. That puts a decision under $0.0001 on Jev or Microsoft-Decision-1, and around $0.0002 on GPT-6 Luna Decisions. For background on the three models, read [OpenAI Decisions API on LLM Gateway](/blog/openai-decisions-api).

## What the demo shows

Every routing decision in the video came from a real session, read back from DevPass Code's logs:

- **"What does this project do?"** Microsoft-Decision-1 picked **fast**, and `claude-haiku-5-5` answered in 8.9 seconds.
- **"Move orders to SQLite"**, in a second tab. Microsoft-Decision-1 picked **balanced**, and `claude-sonnet-5-5` finished the migration in 35.9 seconds with 12 tests passing.
- **"Redesign the orders service"** as a multi-region service with exactly-once payments, in a third tab switched to Jev. Jev picked **frontier**, and `claude-opus-5-5` asked four clarifying questions before writing any code.

## Session tabs: several agents side by side

DevPass Code 2.0 is built on opencode v2, and session tabs are on by default. Each tab is its own session with its own model and decision model, and the tab strip shows which ones are working, waiting for you, or done.

| Action                      | Keys                               |
| --------------------------- | ---------------------------------- |
| New session in a new tab    | `ctrl+x` then `n`                  |
| Next / previous tab         | `alt+down` / `alt+up`              |
| Jump to the next unread tab | `alt+shift+down`                   |
| Go to tab 1–9               | `ctrl+1` … `ctrl+9`                |
| Close / reopen a tab        | `ctrl+x` then `w` / `ctrl+shift+t` |

Start a long refactor in one tab, ask a quick question in another, and come back when the first one needs you.

## Change the models behind each tier

The defaults are Anthropic's current Haiku, Sonnet and Opus. To route to different models, set the tiers in order, fast first. Any model ID from the LLM Gateway catalog works:

```bash
export DEVPASS_SMART_ROUTER_MODELS="claude-haiku-5-5,gpt-5.5,claude-opus-5-5"
export DEVPASS_SMART_ROUTER_DECISION_MODEL="microsoft-decision-1"
devpass-code
```

The model picker itself now lists chat models only, so image, voice and transcription models no longer crowd the list.

## Install or upgrade

DevPass Code is open source and talks only to LLM Gateway. Install it from npm or Homebrew:

```bash
npm i -g devpass-code
# or
brew install theopenco/tap/devpass-code
```

Already on DevPass Code 1.x? Run `npm i -g devpass-code@latest` or `brew upgrade devpass-code`. From 2.0 on, `devpass-code upgrade` checks npm and the Homebrew tap for you. Existing `opencode.json` and `.opencode/` config files are still read.

---

- **[Try LLM Gateway free](https://llmgateway.io/signup)**
- **[Set up DevPass Code](https://docs.llmgateway.io/guides/devpass-code)**
- **[DevPass Code: a terminal coding agent for LLM Gateway](/blog/devpass-code)**
