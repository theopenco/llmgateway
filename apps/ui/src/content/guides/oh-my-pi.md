---
id: oh-my-pi
slug: oh-my-pi
title: Oh My Pi Integration
seoTitle: Use Oh My Pi with LLM Gateway and DevPass
description: Connect Oh My Pi to LLM Gateway or DevPass, discover models, and run a coding task from your terminal.
date: 2026-09-22
---

[Oh My Pi](https://omp.sh) (`omp`) is a terminal coding agent with file editing, shell, language-server, and debugger tools. Connect it to LLM Gateway with a pay-as-you-go or DevPass API key.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/PFWJM46-124"
		title="Oh My Pi setup and coding demo with LLM Gateway"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install Oh My Pi

On macOS or Linux:

```bash
curl -fsSL https://omp.sh/install | sh
omp --version
```

See the&nbsp;[installation guide](https://omp.sh/docs) for other platforms and package managers.

## Connect LLM Gateway or DevPass

Create an API key in your&nbsp;[LLM Gateway dashboard](https://llmgateway.io/dashboard) or&nbsp;[DevPass dashboard](https://devpass.llmgateway.io/dashboard). Export it in the terminal where you will run Oh My Pi:

```bash
export LLMGATEWAY_API_KEY="your_api_key"
```

Create or update `~/.omp/agent/models.yml`. Merge this entry into any existing `providers` mapping:

```yaml
providers:
  llmgateway:
    baseUrl: https://api.llmgateway.io/v1
    api: openai-completions
    apiKey: LLMGATEWAY_API_KEY
    discovery:
      type: openai-models-list
```

`apiKey` names the environment variable. Discovery loads the gateway's `/v1/models` catalogue, so you do not need to maintain a model list in the configuration. The same endpoint works with either kind of key; the key determines your workspace and billing.

## Select a model

Start Oh My Pi in your project:

```bash
cd your-project
omp
```

On first launch, finish the setup wizard; the configured provider appears in the model step.

Run `/model`, choose **llmgateway**, and select a text model with tool support from the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools). With DevPass, choose a model supported by your plan.

To select a model when launching, replace `MODEL_ID` with its canonical catalogue ID:

```bash
omp --model llmgateway/MODEL_ID
```

Here, `llmgateway/` selects the custom provider inside Oh My Pi. It is not an upstream provider pin. Keep the remaining model ID canonical for DevPass routing.

## Verify the connection

Ask Oh My Pi to fix a small failing test in your project:

```text
Read the failing test, make the smallest fix, run the tests again,
and summarize the result. Do not edit the tests.
```

Review the diff and test output, then check usage in the dashboard for the workspace that issued your key.

For a one-shot task:

```bash
omp --model llmgateway/MODEL_ID -p "Explain this project without changing files"
```

## Troubleshooting

- **Provider missing:** Check `~/.omp/agent/models.yml`, including YAML indentation, then restart `omp`.
- **Authentication failed:** Export `LLMGATEWAY_API_KEY` in the same shell before launching the agent.
- **Model rejected:** Select a tool-capable model available to your account. DevPass does not support upstream provider-pinned model IDs.
- **Discovery failed:** Check the base URL and use `openai-models-list` for the gateway's OpenAI-compatible catalogue.

See the&nbsp;[Oh My Pi model configuration reference](https://github.com/can1357/oh-my-pi/blob/main/docs/models.md) for additional settings.
