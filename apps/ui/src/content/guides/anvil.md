---
id: anvil
slug: anvil
title: Anvil Integration
seoTitle: Use Anvil with LLM Gateway
description: Connect Anvil to LLM Gateway, choose DevPass or pay-as-you-go billing, and configure its local coding engine.
date: 2026-09-23
---

[Anvil](https://anvilstack.dev) is a desktop workspace for repository-based agent work. Its built-in LLM Gateway connector supports browser authorization and API keys.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/Kw93PYoV67I"
		title="Anvil setup walkthrough with LLM Gateway"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install Anvil

Download the desktop app from the&nbsp;[official releases](https://github.com/anthonyhumphreys/anvil-stack/releases). On first launch, choose your role and open **Primary agent**. You can also configure providers later in **Settings**.

## Connect LLM Gateway

Select **LLMGateway**, then choose the billing mode matching your account:

| Mode          | Use it with                                               |
| ------------- | --------------------------------------------------------- |
| DevPass       | A coding plan and canonical models supported by that plan |
| Pay as you go | A workspace billed against gateway credits                |

Click **Connect in browser**. Review the account and organization on the authorization page, then approve the connection while Anvil stays open. Alternatively, paste an existing key into **API key (alternative)**.

The selected mode determines which model catalogue Anvil loads. Keep DevPass models canonical; provider-pinned routing is not available on coding plans.

## Check the coding engine

Anvil uses a local Codex coding engine to edit files and run commands. Models and billing still come through LLM Gateway; this connector does not require a separate ChatGPT account.

If Anvil reports that the engine is missing or unavailable, use its **Install coding engine** or **Repair coding engine** control, then check the status again.

## Select a model and test

After connecting, choose a tool-capable model from the validated catalogue and click **Test Connection**. Check capabilities on the&nbsp;[models page](https://llmgateway.io/models?features=tools).

Start a small task in your repository, review the proposed changes, and run the relevant tests. Inspect usage in the gateway workspace you authorized.

## Troubleshooting

**Browser authorization times out:** start the connection again and finish the approval while Anvil remains open.

**No models appear:** check the connected key and billing mode, then refresh the connector status.

**The coding engine is unavailable:** use the install or repair control before starting an agent task.

**Authentication fails:** verify that the key is active, or reconnect in the browser to authorize a new connection.
