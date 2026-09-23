---
id: cline
slug: cline
title: Cline Integration
seoTitle: Use Cline with LLM Gateway
description: Configure Cline's OpenAI-compatible provider, choose a model, and verify a coding task through LLM Gateway.
date: 2026-09-23
---

[Cline](https://cline.bot) is a coding agent for VS Code. Configure its OpenAI-compatible provider to send model requests through LLM Gateway with a pay-as-you-go or DevPass key.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/zpCUxe7ml48"
		title="Cline setup and coding demo with LLM Gateway"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install Cline

Open the VS Code Extensions view with **Cmd/Ctrl + Shift + X**, search for **Cline**, and install the extension published by Cline.

## Connect LLM Gateway

On first launch, choose **Bring my own API key** and continue. For an existing installation, open Cline's settings using the gear icon.

Set these fields:

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| API Provider | `OpenAI Compatible`                              |
| Base URL     | `https://api.llmgateway.io/v1`                   |
| API Key      | A key from your LLM Gateway or DevPass dashboard |
| Model ID     | A tool-capable model ID from the live catalogue  |

Create a key in your&nbsp;[dashboard](https://llmgateway.io/dashboard). Find model IDs, context limits, and capabilities on the&nbsp;[models page](https://llmgateway.io/models?features=tools).

Cline's model configuration also lets you set context and capability information. Match those settings to your selected model. A default or zero cost shown inside Cline is not the gateway's bill; check actual usage in your dashboard.

> **Using DevPass?** Use a canonical model ID included in your plan, without an upstream provider prefix. The gateway selects the provider. See the&nbsp;[DevPass site](https://devpass.llmgateway.io).

## Verify a small task

Open a project and ask Cline to fix one function with an existing test. **Plan** mode can inspect the project and propose a change. Switch to **Act** to apply it.

Review the proposed diff before approving the edit. Approve the test command when prompted, then inspect its output. Keep the scope small until you are comfortable with the tool permissions.

Cline can keep separate models for Plan and Act. If you enable that option, configure both modes to use the intended gateway endpoint and key.

## Troubleshooting

**Authentication fails:** confirm the key is active and the base URL includes `/v1`.

**A model is unavailable:** copy its exact ID from the live catalogue and check that your account can use it.

**Cline plans without editing:** switch to Act mode and approve the proposed edit.

**Terminal output is missing:** check VS Code shell integration. Interactive shell startup prompts can interrupt commands; dismiss them or use a terminal profile with a clean startup, then rerun the test.

**The context limit is wrong:** match Cline's model configuration to the model's documented context window and start a fresh task if the conversation is already too large.
