---
id: autohand
slug: autohand
title: Autohand Code Integration
description: Connect Autohand Code’s built-in LLM Gateway provider with an API key, choose a model, and verify a coding task.
date: 2026-09-23
---

[Autohand Code](https://autohand.ai) is a terminal coding agent with a built-in LLM Gateway provider. Use a pay-as-you-go or DevPass API key to connect it to your workspace.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/9be1L7sX0Ho"
		title="Autohand setup with LLM Gateway"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install

```bash
pnpm add -g autohand-cli
autohand --version
```

See the&nbsp;[Autohand documentation](https://docs.autohand.ai/getting-started/first-session) for installation and onboarding.

## Sign in to Autohand

The current CLI requires an Autohand account even when inference uses a provider API key. Run `autohand login` and complete the browser sign-in before starting a session. Your LLM Gateway key is a separate credential.

## Connect LLM Gateway

Create a key in your&nbsp;[dashboard](https://llmgateway.io/dashboard), then export it before launching Autohand:

```bash
export LLMGATEWAY_API_KEY="your_api_key"
autohand --provider llmgateway --model MODEL_ID
```

Replace `MODEL_ID` with a text model that supports tools from the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools). With DevPass, choose a canonical model ID supported by your plan; provider-pinned routing is unavailable on coding plans.

## Save the provider configuration

To keep LLM Gateway as your default, merge these settings into `~/.autohand/config.json`:

```json
{
  "provider": "llmgateway",
  "llmgateway": {
    "apiKey": "${LLMGATEWAY_API_KEY}",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "MODEL_ID"
  }
}
```

The provider name is a string, with a separate `llmgateway` settings object. Keep the API key in your environment and replace the model placeholder before running the agent.

## Verify a coding task

Start `autohand` from your project directory. Ask it to read a failing test, fix the implementation, and rerun the test without changing the test file. Review its file changes and command output, then check the request in the workspace that issued your key.

## Troubleshooting

- **Wrong provider:** Pass `--provider llmgateway` explicitly or check the top-level `provider` setting.
- **Authentication failed:** Export `LLMGATEWAY_API_KEY` in the same shell and confirm the key is active.
- **Model unavailable:** Choose a tool-capable model allowed by your workspace or DevPass plan.

See Autohand's&nbsp;[LLM Gateway integration reference](https://docs.autohand.ai/integrations/llmgateway) for additional options.
