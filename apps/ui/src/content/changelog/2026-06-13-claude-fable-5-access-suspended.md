---
id: "56"
slug: "claude-fable-5-access-suspended"
date: "2026-06-13"
title: "Claude Fable 5 Access Suspended"
summary: "We've temporarily suspended access to Claude Fable 5 across all providers while we work through a usage-policy matter with Anthropic. Requests to the model now return a clear error, and routing automatically skips it."
image:
  src: "/changelog/claude-fable-5-reve-and-new-models.png"
  alt: "Claude Fable 5 access temporarily suspended on LLM Gateway"
  width: 1024
  height: 1024
---

We've temporarily suspended access to **Claude Fable 5** on LLM Gateway, effective immediately, across every provider that served it.

## What changed

`claude-fable-5` is no longer available through the gateway on either the Anthropic or AWS Bedrock route. Requests that target the model directly now return a clear error rather than silently failing:

```bash
HTTP 410
Model claude-fable-5 has been deactivated and is no longer available
```

Routing and model-selection logic skips the model automatically, so it won't be picked as a fallback target either.

## Why

This is a temporary measure while we work through a usage-policy matter with the upstream provider. We'd rather pause access cleanly than leave you with intermittent failures or unexpected behavior mid-request.

## What you should do

If your application pins `claude-fable-5`, switch to another model for now. Good drop-in options on the gateway include:

```bash
anthropic/claude-opus-4-8
anthropic/claude-3-7-sonnet
```

Both support large context windows, tool use, and structured output, and you can swap them in without changing the rest of your request.

## What's next

We're working to restore access as quickly as we can and will post an update here the moment Claude Fable 5 is back. No action is needed beyond moving any pinned traffic to an alternate model in the meantime.

---

**[Browse all models →](https://llmgateway.io/models)** | **[Open your dashboard →](https://llmgateway.io/dashboard)**
