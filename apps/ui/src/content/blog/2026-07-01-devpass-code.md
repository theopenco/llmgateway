---
id: "blog-devpass-code"
slug: "devpass-code"
date: "2026-07-01"
title: "DevPass Code: A Terminal Coding Agent for LLM Gateway"
summary: "DevPass Code is an open-source terminal coding agent that talks only to LLM Gateway. One browser login, every model, and no per-provider API keys to juggle. Use it pay-as-you-go or on a DevPass coding subscription."
categories: ["Announcements", "Product"]
image:
  src: "/blog/devpass-code-splash.png"
  alt: "The DevPass Code terminal splash screen, showing the model set to Claude Opus 4.8 through LLM Gateway"
  width: 1320
  height: 760
---

Every terminal coding agent asks you to wire up providers before you can write a line of code: an Anthropic key here, an OpenAI key there, a base URL to override, a config file to babysit. Switch models and you do it again. It's setup tax on the exact tool that's supposed to remove busywork.

Today we're releasing **DevPass Code** — an open-source terminal coding agent that talks to exactly one place: **LLM Gateway**. You log in once from your browser, and every text model the gateway serves is available in the same session. No per-provider keys, no base-URL surgery, no reconfiguring to try a different model.

## One login, from the terminal

DevPass Code borrows the login flow you already like from Claude Code. Run one command, and it opens your browser, you approve the connection, and the terminal picks up automatically:

```bash
devpass-code auth login
# → pick a provider → "Log in with browser"
```

Under the hood it starts a short-lived loopback server on `localhost`, opens `https://llmgateway.io/connect/cli`, and the freshly minted API key is handed straight back to your machine — it never leaves it. Prefer to paste a key you already have? Choose **Paste an API key** instead. Credentials live in `~/.local/share/devpass-code/auth.json`, and the connect page only ever redirects to a local address.

## Two providers, two ways to pay

DevPass Code ships with two providers and nothing else. Both route to `https://api.llmgateway.io/v1`; the gateway decides how each request is billed from the account behind your key.

| Provider                | Use it when                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **LLM Gateway**         | You pay as you go with credits or your own LLM Gateway API key.                                                            |
| **LLM Gateway DevPass** | You're on a [DevPass](https://llmgateway.io) coding subscription — billing is handled automatically, no per-request setup. |

Every text model on the gateway — roughly 190 of them, from Claude Opus and GPT-5.5 to Gemini 3 Pro and Grok — shows up in the model picker. Switching is a keystroke, not a config change.

## Built on opencode, focused on the gateway

DevPass Code is a fork of [opencode](https://github.com/anomalyco/opencode) (MIT), rebranded and stripped down to a single upstream. We kept the parts that make opencode good — the fast TUI, agents, tools, MCP support, session management — and removed the provider sprawl. The result is a coding agent that does one thing: route your work through LLM Gateway, with an interface that matches the gateway's design.

It sends an `x-source: devpass-code` header on every request, so if you're on DevPass your usage is attributed correctly and shows up in your dashboard alongside your other coding tools.

![DevPass Code editing a file in a coding session, with a syntax-highlighted diff and tool output](/blog/devpass-code-session.png)

## Install it

DevPass Code runs on [Bun](https://bun.sh). Clone the repo and go:

```bash
git clone https://github.com/theopenco/devpass-code
cd devpass-code
bun install
bun run packages/devpass-code/src/index.ts --help
```

Then authenticate and start a session:

```bash
devpass-code auth login   # one-click browser login
devpass-code              # launch the TUI in your project
```

If you'd rather not log in interactively, set `LLMGATEWAY_API_KEY` in your environment and DevPass Code will use it directly.

## Frequently Asked Questions

### Is DevPass Code free?

The tool is open source (MIT) and free to run. You pay only for the models you use through LLM Gateway — either pay-as-you-go credits or a DevPass subscription. There's no separate charge for the agent itself.

### Do I need a DevPass subscription to use it?

No. Pick the **LLM Gateway** provider and you're on pay-as-you-go with your own key or credits. The **LLM Gateway DevPass** provider is there for subscribers who want flat-rate coding usage.

### Which models can I use?

Any text model LLM Gateway supports — about 190 today across Anthropic, OpenAI, Google, xAI, DeepSeek, and more. DevPass Code fetches the live catalog, so new models appear without an update.

### How is this different from using opencode directly?

opencode supports dozens of providers and needs per-provider setup. DevPass Code is the same core with everything pointed at LLM Gateway: one browser login, one billing relationship, and a UI themed to match the gateway.

## Get started

- **[Try LLM Gateway free](https://llmgateway.io/signup)** and grab an API key
- **[DevPass Code on GitHub](https://github.com/theopenco/devpass-code)** — clone, install, and log in
- Read the [coding agents guide](https://docs.llmgateway.io/guides/devpass-code) to connect it to your workflow
