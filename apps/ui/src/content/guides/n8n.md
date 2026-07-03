---
id: n8n
slug: n8n
title: n8n Integration
description: Power n8n AI workflows with any of 280+ models through LLM Gateway. One OpenAI credential, every provider, full cost visibility per workflow.
date: 2026-07-03
---

n8n is a workflow automation platform with first-class AI nodes. Point its OpenAI credential at LLM Gateway and every AI Agent, Chat Model, and LLM node in your workflows can use any model from our catalog — GPT-5, Claude, Gemini, DeepSeek, or 280+ others — with one credential and one bill.

![n8n workflow with LLM Gateway](https://docs.llmgateway.io/guides/n8n/overview.png)

## Quick Start

### 1. Add an OpenAI credential

In n8n, go to **Settings → Credentials → Add Credential → OpenAI** and set:

- **API Key**: your key from the [LLM Gateway dashboard](/dashboard)
- **Base URL**: `https://api.llmgateway.io/v1`
- **Organization ID**: leave blank

![n8n credential setup](https://docs.llmgateway.io/guides/n8n/credential-3.png)

### 2. Wire up an AI Agent node

Add an **AI Agent** node to your workflow and attach a **Chat Model** using the credential you just created.

![n8n AI Agent node](https://docs.llmgateway.io/guides/n8n/node-1.png)

**Important:** toggle **off** the Responses API option on the chat model node — n8n's Responses API mode is not supported; LLM Gateway uses the standard chat completions API here.

![Responses API toggle](https://docs.llmgateway.io/guides/n8n/responses-api.png)

### 3. Pick a model and run

Set the model to any [LLM Gateway model ID](https://llmgateway.io/models) (e.g. `gpt-5`) and execute the workflow with a test prompt.

![n8n test run](https://docs.llmgateway.io/guides/n8n/test.png)

## Why this beats a direct provider credential

Automation workflows are exactly where gateway routing pays off:

- **Swap models without touching workflows** — change the model ID, keep the credential; or let LLM Gateway's routing pick the best-value provider automatically
- **Per-workflow cost visibility** — every n8n execution shows up in your [dashboard](/dashboard) with token counts and cost, so you know what each automation actually costs
- **Failover for unattended runs** — scheduled workflows keep running when a provider has an outage; the gateway retries on a healthy provider
- **Caching** — workflows that re-process similar inputs hit the cache instead of paying twice
- **Free and discounted models** — batch or low-stakes steps can run on [free models](https://llmgateway.io/models?view=grid&filters=1&free=true) or [discounted models](https://llmgateway.io/models?view=grid&filters=1&discounted=true)

## Troubleshooting

**Credential test fails** — Verify the base URL is exactly `https://api.llmgateway.io/v1` and the key is valid.

**Errors on the chat model node** — Make sure the Responses API toggle is off (see step 2).

**Model not found** — Use the exact model ID from the [models page](https://llmgateway.io/models); prefix with a provider (e.g. `openai/gpt-5`) to pin routing.

Need help? Join our [Discord](https://llmgateway.io/discord).

[Get started for free](/signup) — no credit card required.
