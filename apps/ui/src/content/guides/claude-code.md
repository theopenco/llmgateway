---
id: claude-code
slug: claude-code
title: Claude Code Integration
seoTitle: Use Claude Code with LLM Gateway
description: Connect Claude Code to LLM Gateway with environment variables and verify a real file edit and test run.
date: 2026-09-07
---

Claude Code can use LLM Gateway's Anthropic-compatible endpoint while the gateway routes requests to your selected model. This walkthrough was verified with Claude Code 2.1.263.

## Video walkthrough

<div className="relative aspect-video">
  <iframe
    className="absolute inset-0 h-full w-full rounded-lg border-0"
    src="https://www.youtube-nocookie.com/embed/arip9L7LAPY"
    title="Claude Code setup and coding demo with LLM Gateway"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  ></iframe>
</div>

## Install

Install Claude Code using the&nbsp;[official instructions](https://code.claude.com/docs/en/setup), then check `claude --version`.

## Configure the connection

Create a key in your&nbsp;[dashboard](https://llmgateway.io/dashboard), then set these variables in the terminal where you launch Claude Code:

```bash
export ANTHROPIC_BASE_URL=https://api.llmgateway.io
export ANTHROPIC_AUTH_TOKEN="your_api_key"
export ANTHROPIC_MODEL=deepseek-v4-flash
claude
```

Use the base URL exactly as shown. Claude Code adds `/v1/messages` itself. If an existing `ANTHROPIC_API_KEY` causes an authentication conflict, unset it in this shell before starting.

The example model supports the tool calls needed to read, edit, and test code. Find other compatible choices in the&nbsp;[live model catalogue](https://llmgateway.io/models?features=tools).

## Choose a model

Set `ANTHROPIC_MODEL` before launch, or override it for one session:

```bash
claude --model deepseek-v4-flash
```

Claude Code's picker and model-discovery behavior vary by version. An explicit `--model` value is useful when your model is absent from the picker.

To add a custom picker option, current Claude Code also supports:

```bash
export ANTHROPIC_CUSTOM_MODEL_OPTION=deepseek-v4-flash
export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="DeepSeek V4 Flash"
```

To discover the gateway models supported by Claude Code's picker, set `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` before launch. Discovery is subject to the client's model filtering; it does not guarantee that every gateway model appears.

## Verify the connection

Open a small project and ask the agent to read a file, make a change, and run its tests. Our recorded example fixes a TypeScript slugifier and passes all three tests with `deepseek-v4-flash` through LLM Gateway.

`Hello, LLM Gateway!` becomes `hello-llm-gateway`; repeated separators collapse into one hyphen; empty and punctuation-only inputs stay empty. The demo uses Node.js 24 to run `node --test slugify.test.ts` directly.

Review the diff and test output, then check the request in your&nbsp;[LLM Gateway dashboard](https://llmgateway.io/dashboard). Choose other compatible models from the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools).

![Claude Code completing the coding task through LLM Gateway](/images/guides/claude-code/verified-session.png)

## Troubleshooting

- **Requests use the wrong endpoint:** check `ANTHROPIC_BASE_URL` in the shell that starts Claude Code and restart the agent after changing it.
- **Authentication fails:** verify the gateway key and resolve conflicting Anthropic authentication variables.
- **A model is missing from the picker:** launch with an explicit `--model` ID from the catalogue.
- **An optional tool is unsupported:** use a model with the required capability, or disable the tool for that session.

A&nbsp;[DevPass](https://devpass.llmgateway.io) plan key can also be used. Use canonical model IDs for plan routing.
