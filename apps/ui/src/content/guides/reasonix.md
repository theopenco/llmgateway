---
id: reasonix
slug: reasonix
title: Reasonix Integration
seoTitle: "Use Reasonix with LLM Gateway"
description: Connect Reasonix to LLM Gateway, choose a model, and verify the connection with a real coding task.
date: 2026-09-07
---

[Reasonix](https://github.com/esengine/DeepSeek-Reasonix) is an open-source coding agent with a terminal interface, desktop app, and editor integration. Its current release supports OpenAI-compatible endpoints, so you can connect it directly to LLM Gateway.

This walkthrough was verified with Reasonix 1.38.1: the agent read a TypeScript project, edited a function, and ran its tests through the gateway.

## Video walkthrough

<div className="relative aspect-video">
  <iframe
    className="absolute inset-0 h-full w-full rounded-lg border-0"
    src="https://www.youtube-nocookie.com/embed/lAo5ydmTlyw"
    title="Reasonix setup and coding demo with LLM Gateway"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  ></iframe>
</div>

## Install

Install the current native CLI:

```bash
pnpm add -g reasonix
reasonix --version
```

See the&nbsp;[official installation instructions](https://github.com/esengine/DeepSeek-Reasonix#install) for other platforms and installation methods. These instructions apply to Reasonix 1.x; the older 0.x release uses a different configuration format.

## Connect to LLM Gateway

Run the provider setup:

```bash
reasonix setup
```

Add an **OpenAI-compatible** provider with these values:

| Setting       | Value                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Provider name | `llmgateway`                                                                        |
| Base URL      | `https://api.llmgateway.io/v1`                                                      |
| API key       | Your LLM Gateway API key                                                            |
| Model         | A text model with tool support from the [models page](https://llmgateway.io/models) |

Choose **Save and exit**, then select this provider as your default.

Reasonix stores provider definitions in `~/.reasonix/config.toml` on macOS and Linux, or `%AppData%\reasonix\config.toml` on Windows. A minimal configuration looks like this:

```toml
default_model = "llmgateway"

[[providers]]
name = "llmgateway"
kind = "openai"
base_url = "https://api.llmgateway.io/v1"
model = "deepseek-v4-flash"
api_key_env = "LLMGATEWAY_API_KEY"
headers = { x-source = "reasonix" }
```

The model above is the example used for this walkthrough. Copy your preferred model ID from the live catalogue.

**Save the key through `reasonix setup`.** The `api_key_env` field names the entry in Reasonix's own `.env` file. Current Reasonix reads provider secrets from that file inside its configuration directory; exporting a shell variable alone does not configure the key.

> **Using DevPass?** Use a canonical model ID without an upstream provider prefix. The gateway selects the serving provider for coding plans.

![Reasonix connected to the selected gateway model](/images/guides/reasonix/connected.png)

## Try a coding task

Start Reasonix from your project directory:

```bash
cd your-project
reasonix
```

Ask it to fix a specific problem and verify the result:

```text
Fix slugify.ts so all tests pass. Read the files, make the smallest fix,
run node --test slugify.test.ts, and summarize. Do not edit the tests.
```

Reasonix can read files, propose edits, and execute tests. Review any permission prompts before allowing commands. For a one-shot task, use `reasonix run "your task"`.

Check the request's model, tokens, and cost in your&nbsp;[LLM Gateway dashboard](https://llmgateway.io/dashboard).

![Reasonix completing the coding task through LLM Gateway](/images/guides/reasonix/verified-session.png)

## Troubleshooting

### Missing key or authentication error

Open `reasonix setup` and save your LLM Gateway key for the configured provider. Check that `api_key_env` matches the entry in Reasonix's own `.env` file. Keep that file out of your project repository.

### Model not found

Copy the exact ID from the&nbsp;[models page](https://llmgateway.io/models). In Reasonix, `--model llmgateway` selects the configured provider; the provider's `model` field selects the gateway model.

### Requests go to another provider

Set `default_model = "llmgateway"`, or launch with `reasonix --model llmgateway`. Check for a project-level `reasonix.toml`, which can override your user configuration.

### Connection errors

Use `kind = "openai"` and include `/v1` in the base URL. For configuration and diagnostic commands, see the&nbsp;[Reasonix guide](https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md).
