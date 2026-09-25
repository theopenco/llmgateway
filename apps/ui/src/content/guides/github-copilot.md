---
id: github-copilot
slug: github-copilot
title: GitHub Copilot App Integration
date: 2026-09-23
description: Configure the GitHub Copilot app with LLM Gateway, review account prerequisites, and choose a compatible agent model.
---

The&nbsp;[GitHub Copilot app](https://github.com/features/ai/github-app) supports custom model providers for agent sessions. Add LLM Gateway as an OpenAI-compatible endpoint and choose a model available to your workspace.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/_0ApXCTletU"
		title="GitHub Copilot App setup with LLM Gateway"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install and sign in

Install the app from GitHub's official download page and sign in with your GitHub account. Review the requested authorization before approving it.

GitHub account sign-in is required even when you supply your own model key. GitHub documents BYOK access without a Copilot subscription; managed accounts may be subject to organization policy. See its&nbsp;[BYOK setup guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/use-byok-models) for current requirements. The feature is in public preview.

## Add LLM Gateway

1. Open app **Settings → Model providers**.
2. Click **Add provider** and choose an **OpenAI-compatible** endpoint.
3. Enter a display name, your gateway workspace key, and the base URL `https://api.llmgateway.io/v1`.
4. Save the provider and open the session's model picker.

Provider credentials are stored in the system credential store. Choose a model with tool calling and streaming support from the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools), then test it in a small local project.

With a&nbsp;[DevPass](https://devpass.llmgateway.io) key, use a canonical model included in your plan. Upstream provider prefixes pin routing and are not supported on coding plans.

## Check reasoning settings

Model discovery may supply only model IDs. If the app does not retain your reasoning selection, edit the model under **Model providers** and configure its supported reasoning effort levels.

Use only levels supported by the selected model and mapping. The model's live catalogue page shows these capabilities; the models API exposes declared levels under `providers[].reasoning_efforts`.

## Verify a session

Choose the connected provider and model explicitly. Ask the agent to inspect a small project, fix one failing test, and run the tests without changing them. Review permissions, the resulting diff, and the actual command output.

Check usage in the workspace that issued your gateway key. A configured provider or successful sign-in alone does not prove that an agent task completed.

## Troubleshooting

**Sign-in expires:** restart the app's sign-in flow and complete the browser authorization before the device code expires.

**The provider or model is missing:** update the app, check the saved base URL and active key, and review managed-account policy.

**Reasoning selection resets:** configure supported levels on the provider's model entry.

**A request is rejected:** inspect the error, model capability, and workspace access. Do not assume every catalogue model supports the app's agent workflow.

For editor-based Copilot setup, see the separate&nbsp;[VS Code guide](https://docs.llmgateway.io/guides/vscode).
