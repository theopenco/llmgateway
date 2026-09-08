---
id: codex-cli
slug: codex-cli
title: Codex CLI Integration
seoTitle: Use Codex CLI with LLM Gateway
description: Configure Codex CLI with an LLM Gateway provider, connect your API key, and verify file edits and test execution.
date: 2026-09-07
---

[Codex CLI](https://github.com/openai/codex) can connect to LLM Gateway through a custom provider using the Responses API. This walkthrough was verified with Codex CLI 0.153.4.

## Video walkthrough

<div className="relative aspect-video">
  <iframe
    className="absolute inset-0 h-full w-full rounded-lg border-0"
    src="https://www.youtube-nocookie.com/embed/kMlEJ9rktPY"
    title="Codex CLI setup and coding demo with LLM Gateway"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  ></iframe>
</div>

## Install

```bash
pnpm add -g @openai/codex
codex --version
```

## Configure LLM Gateway

Create a key in your&nbsp;[dashboard](https://llmgateway.io/dashboard) and export it in the terminal where you launch Codex:

```bash
export LLMGATEWAY_API_KEY="your_api_key"
```

Merge these settings into `~/.codex/config.toml`:

```toml
model = "deepseek-v4-flash"
model_provider = "llmgateway"
model_reasoning_effort = "low"
web_search = "disabled"

[model_providers.llmgateway]
name = "LLM Gateway"
base_url = "https://api.llmgateway.io/v1"
env_key = "LLMGATEWAY_API_KEY"
wire_api = "responses"
```

The named provider reads your gateway key from the environment. You can keep your existing ChatGPT login. Current Codex versions use `responses`; changing an environment variable cannot switch them to Chat Completions.

Web search is disabled for this example because the selected model does not support native web search. Enable it only after selecting a model with that capability in the&nbsp;[catalogue](https://llmgateway.io/models?features=webSearch).

## Start coding

```bash
cd your-project
codex
```

For a scripted task:

```bash
codex exec --sandbox workspace-write "Fix the failing test and run it again"
```

## Verify the connection

Open a small project and ask the agent to read a file, make a change, and run its tests. Our recorded example fixes a TypeScript slugifier and passes all three tests with `deepseek-v4-flash` through LLM Gateway.

`Hello, LLM Gateway!` becomes `hello-llm-gateway`; repeated separators collapse into one hyphen; empty and punctuation-only inputs stay empty. The demo uses Node.js 24 to run `node --test slugify.test.ts` directly.

Review the diff and test output, then check the request in your&nbsp;[LLM Gateway dashboard](https://llmgateway.io/dashboard). Choose other compatible models from the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools).

![Codex CLI completing the coding task through LLM Gateway](/images/guides/codex-cli/verified-session.png)

## Troubleshooting

- **Authentication fails:** check that `model_provider` matches the provider table and that `LLMGATEWAY_API_KEY` is exported in the same shell.
- **Native web search is unsupported:** set `web_search = "disabled"`, then start a new session.
- **Model metadata or catalogue refresh warning:** Codex 0.153.4 can warn about missing metadata or the gateway's model-list response format. Our configured model still completed the task. Use an explicit model ID and verify the actual request result.
- **Wrong endpoint:** the provider's `base_url` must end in `/v1`.

See OpenAI's&nbsp;[custom-provider configuration](https://developers.openai.com/codex/config-advanced/) for configuration profiles and other options.
