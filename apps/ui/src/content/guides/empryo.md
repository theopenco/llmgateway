---
id: empryo
slug: empryo
title: Empryo Integration
seoTitle: Use Empryo with LLM Gateway
description: Connect Empryo’s desktop app and terminal UI to LLM Gateway or DevPass, choose a model, and run a coding task.
date: 2026-09-23
---

[Empryo](https://empryo.com) is a coding agent with a desktop app, terminal UI, and headless CLI. LLM Gateway is built in to both interactive interfaces. Connect with browser login or an existing API key, then choose a model for your project.

## Video walkthrough

<div className="relative aspect-video">
  <iframe
    className="absolute inset-0 h-full w-full rounded-lg border-0"
    src="https://www.youtube-nocookie.com/embed/YHnJCQ4b4Sk"
    title="Empryo setup and coding demo with LLM Gateway"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerPolicy="strict-origin-when-cross-origin"
    allowFullScreen
  ></iframe>
</div>

## Install

Use the&nbsp;[official installer or release downloads](https://empryo.com/download), then verify the installed version:

```bash
empryo --version
```

## Desktop app (GUI)

Download the desktop app from the&nbsp;[Empryo downloads page](https://empryo.com/download), then open a project folder from the workspace selector.

### Connect your account

On first launch, the **Connect a model** screen walks through **Provider**, **Account**, and **Model**:

1. Select **LLM Gateway** as the provider.
2. Choose browser login for pay-as-you-go, or the **DevPass** login option for a coding plan. In an already connected profile, these actions appear as **Reconnect** and **Reconnect · DevPass**.
3. Finish authorization in your browser and return to Empryo. Keep the app running until the callback completes.
4. Choose a tool-capable model and click **Start**.

To use a key instead, enter it in **LLM Gateway API key** and click **Connect**. When both a browser connection and a key exist, the **Use** control chooses **Auto**, **Connection**, or **Key**. Select the credential matching the workspace you intend to bill.

### Work in the desktop app

Use the model selector in the top bar to change models. Enter your task in the chat composer, inspect the file changes, and check the test output before accepting the result. The workspace tree and diff viewer let you review what the agent changed alongside the conversation.

## Terminal UI (TUI)

### Log in with your browser

Start Empryo in your project:

```bash
cd your-project
empryo
```

Type `/login` to connect a pay-as-you-go LLM Gateway account. For a&nbsp;[DevPass](https://devpass.llmgateway.io) subscription, use `/login llmgateway-devpass`.

The agent opens the gateway's authorization page in your browser. Check the account and project, then approve the connection. Approval creates an API key and returns it to Empryo through a local callback. Keep the terminal running until the callback finishes.

You can start the same flow directly from the shell:

```bash
empryo --login llmgateway
# For a DevPass subscription:
empryo --login llmgateway-devpass
```

If the browser reports an active-key limit, manage your organization's API keys in the&nbsp;[dashboard](https://llmgateway.io/dashboard) before starting the login flow again. If the local callback expires, restart login to get a fresh authorization link.

![Empryo browser authorization completed](/images/guides/empryo/browser-login.png)

### Choose a model

Open `/models` and select a compatible model under LLM Gateway. The picker reads model information from the gateway; use the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools) to check current capabilities.

The leading `llmgateway/` in Empryo's model selector identifies the agent's provider. For DevPass, keep the remaining model ID canonical; do not pin an upstream provider.

### Use an existing API key

For scripts or an existing gateway credential, export the key before starting Empryo:

```bash
export LLM_GATEWAY_API_KEY="your_api_key"
empryo
```

Empryo uses `LLM_GATEWAY_API_KEY`, including the underscore between `LLM` and `GATEWAY`. You can also enter a key through `/keys`.

A browser login issues a new credential; it does not reuse a key you already copied from the dashboard.

## Verify the connection

In either interface, ask the agent to read a file, make a small edit, and run the project's tests. Review both the diff and test output; a completed chat response alone does not prove the change works.

For a headless task, replace `MODEL_ID` with a tool-capable model from the live catalogue:

```bash
empryo --headless --model llmgateway/MODEL_ID \
  "Fix the failing test and run it again"
```

Review the diff and test output, then check the request in your&nbsp;[dashboard](https://llmgateway.io/dashboard). Empryo tags gateway requests with `x-source: empryo` for attribution.

See the&nbsp;[Empryo documentation](https://empryo.com/docs) for additional desktop and terminal controls.

![Empryo completing the coding task through LLM Gateway](/images/guides/empryo/verified-session.png)
