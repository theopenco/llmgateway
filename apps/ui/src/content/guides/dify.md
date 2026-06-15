---
id: dify
slug: dify
title: Dify Integration
description: Connect Dify's open-source LLM app development platform to LLM Gateway for AI-powered agents and workflows.
date: 2026-06-15
---

[Dify](https://dify.ai) is an open-source LLM app development platform that helps developers build and deploy production-grade AI agents, assistants, and workflow automations. By integrating Dify with LLM Gateway, you gain access to 210+ models (including GPT-5.5, Claude, Gemini, DeepSeek, and more) with built-in cost tracking, response caching, and automatic provider fallbacks.

This guide walks you through connecting Dify to LLM Gateway using the custom OpenAI-compatible provider option.

## Prerequisites

- An LLM Gateway API key — [sign up free](/signup) (no credit card required)
- A Dify Cloud account or a self-hosted Dify instance

## Setup

### Step 1: Open Model Provider Settings

Log in to your Dify dashboard. In the bottom-left corner of the sidebar, click on your profile picture or workspace name, and select **Settings**.

Navigate to the **Model Provider** page to view your active and available LLM configurations.

![Opening Model Provider Settings in Dify](https://docs.llmgateway.io/guides/dify/0-add-provider.png)

### Step 2: Add Custom OpenAI-compatible Provider

Scroll down to the **Custom Providers** section. Locate the **OpenAI-API-compatible** card and click **Setup** (or click **Add Custom Provider** and select **OpenAI-API-compatible**).

![Selecting OpenAI-compatible provider in Dify](https://docs.llmgateway.io/guides/dify/1-configure-provider.png)

### Step 3: Configure Provider Connection

In the setup modal, configure the connection settings for LLM Gateway:

- **Provider Name**: Enter `LLM Gateway`.
- **API Endpoint URL**: Enter `https://api.llmgateway.io/v1`.
- **API Key**: Paste your LLM Gateway API key (starts with `llmgtwy_`).

![Configuring LLM Gateway connection in Dify](https://docs.llmgateway.io/guides/dify/2-add-model.png)

### Step 4: Add Models

Inside the same provider configuration, register the models you wish to use from the LLM Gateway catalog:

1. Click **Add Model**.
2. Set **Model Name** to your desired model identifier (e.g., `openai/gpt-4o-mini`, `anthropic/claude-3-5-sonnet`, `deepseek/deepseek-r1`).
3. Set **Model Type** to **LLM**.
4. Configure model capabilities (such as whether it supports system prompts, function calling, vision, etc.).
5. Click **Save** to add the model.

![Registering custom models in Dify](https://docs.llmgateway.io/guides/dify/3-provider-added.png)

_You can add multiple models to the same LLM Gateway provider block by repeating this step for other model IDs in the catalog._

### Step 5: Save and Verify Provider

Once you have added your models and finished configuring the credentials, click **Save** in the main modal. LLM Gateway will now appear as an active provider in your Dify workspace.

![LLM Gateway active provider status in Dify](https://docs.llmgateway.io/guides/dify/4-select-model.png)

### Step 6: Use LLM Gateway Models in Apps

Create a new application (chatbot, agent, or workflow) in Dify or open an existing one. In the top-right corner of the orchestrator/studio view, click the **Model** dropdown.

Select **LLM Gateway** as the provider, and choose one of the custom models you registered (e.g., `gpt-4o-mini`).

![Selecting LLM Gateway models in Dify app builder](https://docs.llmgateway.io/guides/dify/5-test-chat.png)

### Step 7: Run and Monitor

Try sending a message in the debug console to test your connection. Dify will route the prompt through LLM Gateway, allowing you to monitor real-time token usage, latency, and cost details in your LLM Gateway dashboard.

![Verifying chat outputs and latency in Dify](https://docs.llmgateway.io/guides/dify/6-chat-details.png)

## Why Use LLM Gateway with Dify?

- **Access 210+ models** — Switch between OpenAI, Anthropic, Google Vertex, and open-source models with a single provider endpoint.
- **Cost optimization** — Save up to 90% on selected models using LLM Gateway's developer volume pricing.
- **Enterprise fallbacks** — Prevent system downtime by letting LLM Gateway route requests to a backup provider automatically if the primary provider goes offline.
- **Prompt caching** — Automatically cache repeated workflow prompts to reduce execution latencies and save API costs.
