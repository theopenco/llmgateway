---
id: use-case-reverse-engineering
slug: reverse-engineering
date: 2026-10-25
title: Reverse engineering with AI agents
metaTitle: "LLM Gateway for AI Reverse Engineering — REA, Ghidra, Hopper"
description: "Run REA (Reverse Engineer Anything), Ghidra and Hopper agents on models that do not stop mid-task. One key for DeepSeek, Kimi, GLM, Qwen and 200+ models, with Claude Code and Codex compatibility and per-request cost tracking."
headline: "Keep your REA, Claude Code or Codex setup. Swap the model behind it for one that finishes the analysis."
summary: "Point your reverse-engineering agent at one endpoint and choose a model that reads decompiler output, calls Ghidra and Hopper tools, and does not halt halfway through a binary."
benefits:
  - title: Models that finish the job
    description: "DeepSeek V4 Pro, Kimi K3.1 Pro, GLM-5.2, Qwen3.7 Max, MiniMax M3 and more — open-weight models with no cyber refusal layer, all with tool calling for MCP-driven Ghidra, Hopper and IDA sessions."
  - title: Drop-in for Claude Code and Codex
    description: "An Anthropic-compatible /v1/messages endpoint and an OpenAI-compatible /v1 endpoint. Set a base URL and a key; REA's MCP server and skill stay exactly as they are."
  - title: Million-token context
    description: "A full Ghidra export of a mid-sized binary runs to hundreds of thousands of tokens. DeepSeek V4, Kimi K3.1 Pro and GLM-5.2 hold 1M tokens, so the agent reads the whole program instead of a window."
  - title: Cheap bulk passes, frontier polish
    description: "Name 2,000 functions on DeepSeek V4.1 Flash at $0.15 per million input tokens, then hand the final write-up to a frontier model. Every request is logged with its exact cost."
faqs:
  - question: Which AI models are best for reverse engineering?
    answer: "DeepSeek V4 Pro and Kimi K3.1 Pro lead the open-weight field: strong reasoning over pseudocode, reliable tool calling, 1M-token context. GLM-5.2, Qwen3.7 Max and MiniMax M3 are close behind, and DeepSeek V4.1 Flash is the budget pick for bulk function naming. The full list with live prices is on the reverse engineering models page at /models/reverse-engineering."
  - question: Why not just use Claude Opus 5.5?
    answer: "Since October 21, 2026, users have reported that Claude Opus 5.5 stops reverse-engineering responses mid-answer and will not reproduce them when reworded. Anthropic has not confirmed a change, but Opus 5.5 shipped on September 22, 2026 with safeguards covering cybersecurity, and Anthropic's own launch notes say interrupted cyber tasks were completed by Claude Opus 4.8. Open-weight models have no such classifier."
  - question: Does REA work through LLM Gateway?
    answer: "Yes. REA registers an MCP server with your agent (npx rea-agents setup); it does not care which model the agent talks to. Export ANTHROPIC_BASE_URL=https://api.llmgateway.io and ANTHROPIC_AUTH_TOKEN for Claude Code, or add an llmgateway model provider with base_url https://api.llmgateway.io/v1 for Codex, then pick a model ID such as deepseek-v4-pro. Ghidra, Hopper and IDA run locally as before."
  - question: Is reverse engineering with AI legal?
    answer: "Often, within limits. Your own code, open-source software, malware in a sandbox and CTF challenges are generally fine, and interoperability and security research have explicit exemptions in many jurisdictions. Copying closed-source code into a product, breaking DRM or probing systems you do not own is where it stops being legal. Check the licence and local law before you publish."
---

## The agent is fine. The model is the problem.

Tools like [REA](https://github.com/morluto/rea) turned reverse engineering into an agent workflow: `npx rea-agents setup` gives Claude Code, Codex, Cursor, Gemini CLI, OpenCode or Qwen Code an MCP server that inspects native binaries, Electron and JavaScript apps, .NET assemblies, firmware images and Unity IL2CPP metadata, with Ghidra, Hopper or IDA doing the decompilation. You ask "how does search work in this app, show me the evidence, and build me the same feature", and the agent walks the binary.

Then the model stops. Since October 21, 2026, users have reported Claude Opus 5.5 halting reverse-engineering requests mid-sentence; ChatGPT applies a similar refusal layer to decompiler output and exploit questions. The tooling did not change. The model behind it did.

**LLM Gateway** fixes the half you control. Keep REA, keep your agent, and put a model behind it that reads the pseudocode and keeps going.

## Swap the model, keep the setup

Claude Code reads the Anthropic-compatible endpoint; everything else reads the OpenAI-compatible one. REA's MCP registration and skill are untouched.

```bash
# Claude Code + REA on DeepSeek V4 Pro
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN=$LLM_GATEWAY_API_KEY
export ANTHROPIC_MODEL=deepseek-v4-pro
claude
```

```toml
# ~/.codex/config.toml — Codex + REA on Kimi K3.1 Pro
model = "kimi-k3.1-pro"
model_provider = "llmgateway"

[model_providers.llmgateway]
name = "LLM Gateway"
base_url = "https://api.llmgateway.io/v1"
env_key = "LLM_GATEWAY_API_KEY"
wire_api = "responses"
```

Every model on the [reverse engineering models page](/models/reverse-engineering) supports tool calling, so `analyze-javascript-application`, the Ghidra bridge and the Hopper bridge all work as MCP tools.

## Fit the whole binary in context

A Ghidra export of a mid-sized native binary — pseudocode, strings, cross-references — runs to hundreds of thousands of tokens. On a 128K model the agent reads a window and guesses at the rest. DeepSeek V4 Pro, Kimi K3.1 Pro, GLM-5.2 and Qwen3.7 Max hold a million tokens, so the model sees every call site of the function it is renaming. Prompt caching means the second, third and fiftieth question about the same export does not pay full price for the export again.

## Run the cheap pass cheap

Most of an RE session is bulk work: naming functions, classifying strings, summarising what each module imports. That belongs on DeepSeek V4.1 Flash at $0.15 per million input tokens, not on a frontier model. Route the bulk pass to a budget model, escalate the final explanation or reimplementation to a stronger one, and read the per-request ledger to see exactly what the binary cost you. A model ID without a provider prefix also gets automatic fallback, so a provider outage three hours into a trace does not end the session.

## Stay on the right side of the line

Analysing your own code, open-source software, malware in a sandbox and CTF challenges is generally legal, and interoperability and security research carry explicit exemptions in many jurisdictions. Copying closed-source code into a product, circumventing DRM, or poking at systems you do not own is not. REA's maintainers published a [plain-language guide](https://github.com/morluto/rea/discussions/2304) to what needs permission; read it before you publish.

## Get started

Create a key, set a base URL, pick a model from the [reverse engineering list](/models/reverse-engineering), and run the same REA prompt that stopped yesterday.
