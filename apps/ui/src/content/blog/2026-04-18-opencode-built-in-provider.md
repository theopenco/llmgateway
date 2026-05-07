---
id: blog-opencode-built-in-provider
slug: opencode-built-in-provider
date: 2026-04-18
title: "LLM Gateway Is Now a Built-in Provider in OpenCode"
summary: "No config files, no env vars. OpenCode ships LLM Gateway as a first-class provider — select it, paste your key, and start coding with 210+ models."
categories: ["Integrations"]
image:
  src: "/blog/opencode-built-in-provider.png"
  alt: "LLM Gateway Is Now a Built-in Provider in OpenCode"
  width: 1376
  height: 768
---

OpenCode now ships LLM Gateway as a built-in provider. No config files. No environment variables. No npm adapters.

Select "LLM Gateway" from the provider list, paste your API key, and you have instant access to 210+ models from 60+ providers inside your terminal.

## What changed

Previously, connecting OpenCode to LLM Gateway required creating a `config.json` file, installing the `@ai-sdk/openai-compatible` adapter, and manually defining each model you wanted to use. It worked, but it was friction you shouldn't have to deal with.

Now LLM Gateway appears directly in OpenCode's provider list. The setup is three steps:

1. Run `opencode`
2. Type `/providers` and select **LLM Gateway**
3. Paste your API key

That's it. You're connected to every model we support.

## Why this matters

When a tool you already use adds native support for your infrastructure, it removes the one thing that kills adoption: setup friction.

The difference between "create a config file, add an adapter, define models, restart" and "select from a list and paste a key" is the difference between something engineers _intend_ to try and something they _actually_ try.

Here's what you get with zero configuration:

- **210+ models** across 60+ providers through one API key
- **Automatic cost tracking** for every coding session in your LLM Gateway dashboard
- **Response caching** that saves tokens on repeated requests
- **Automatic failover** across providers when one goes down
- **Volume discounts** that grow as your usage scales

## For teams already using LLM Gateway

If your team uses LLM Gateway for other tools (Claude Code, Cursor, Cline), OpenCode now works the same way. One API key, one dashboard, consistent cost tracking across every coding tool your team uses.

No more per-tool configuration. No more wondering which developer is using which provider key. Every request flows through the same gateway with the same observability.

## Getting started

If you're already using OpenCode:

```bash
opencode
# type /providers → select LLM Gateway → paste your key
```

If you're new to OpenCode, [install it from opencode.ai](https://opencode.ai/download), then follow the same steps.

Need an API key? [Sign up for LLM Gateway](https://llmgateway.io/signup) -- the free tier includes credits to get started.

## Custom model configuration

The built-in provider covers the most popular models automatically. If you need access to a specific model that isn't listed by default, you can still add custom models via `config.json`:

```json
{
  "provider": {
    "llmgateway": {
      "models": {
        "deepseek/deepseek-chat": {
          "name": "DeepSeek Chat"
        }
      }
    }
  }
}
```

Browse all available models on the [models page](https://llmgateway.io/models).

## What's next

We're working with more coding tools to add LLM Gateway as a built-in provider. The goal is simple: if you have an LLM Gateway API key, it should work everywhere without setup.

Check out the full [OpenCode integration guide](/guides/opencode) for detailed documentation, or join our [Discord](https://llmgateway.io/discord) if you run into any issues.
