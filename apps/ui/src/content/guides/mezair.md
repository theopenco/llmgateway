---
id: mezair
slug: mezair
title: Mezair Integration
seoTitle: Use Mezair with LLM Gateway
description: Connect Mezair to LLM Gateway, choose DevPass or pay-as-you-go billing, and configure its local coding engine.
date: 2026-09-23
---

[Mezair](https://mezair.dev) is a desktop workspace for repository-based agent work. Its built-in LLM Gateway connector supports browser authorization and API keys.

## Install Mezair

Follow the [Mezair Desktop installation guide](https://mezair.dev/docs/desktop/installation) to download a release or build from source. Choose **LLMGateway** during first-run setup, or enable it later in **Settings → AI connections & models → AI connections**.

## Connect LLM Gateway

Select **LLMGateway**, then choose the billing mode matching your account:

| Mode          | Use it with                                               |
| ------------- | --------------------------------------------------------- |
| DevPass       | A coding plan and canonical models supported by that plan |
| Pay as you go | A workspace billed against gateway credits                |

Click **Connect in browser**. Review the account and organization on the authorization page, then approve the connection while Mezair stays open. Alternatively, paste an existing key into **API key (alternative)**.

Mezair lists canonical model IDs for DevPass and provider-pinned model IDs for pay-as-you-go.

## Check the coding engine

Mezair uses a local Codex coding engine to edit files and run commands. Your LLM Gateway account provides the models and billing, so you can connect without a ChatGPT account.

If Mezair reports that the engine is missing or unavailable, use its **Install coding engine** or **Repair coding engine** control, then check the status again.

## Select a model and test

Choose **LLMGateway** and a model in the chat model picker. Mezair lists models that support tool calling. Check their capabilities on the [models page](https://llmgateway.io/models?features=tools).

Start a small task in your repository, review the proposed changes, and run the relevant tests. Look for **Mezair** in the **Agents** view of the LLM Gateway workspace you authorized.

## Troubleshooting

**Browser authorization times out:** start the connection again and finish the approval while Mezair remains open.

**No models appear:** check that the key is active and the billing mode matches your LLM Gateway workspace, then reconnect.

**The coding engine is unavailable:** use the install or repair control before starting an agent task.

**Authentication fails:** verify that the key is active, or reconnect in the browser to authorize a new connection.
