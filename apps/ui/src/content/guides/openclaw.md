---
id: openclaw
slug: openclaw
title: OpenClaw Integration
date: 2026-09-23
description: Configure OpenClaw with LLM Gateway, verify a local coding task, and understand provider aliases and tool permissions.
---

[OpenClaw](https://openclaw.ai) runs agents locally and connects them to messaging channels. Configure LLM Gateway as a custom model provider, then verify a local task before connecting a channel.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/QlfT3wCB7X0"
		title="OpenClaw with LLM Gateway walkthrough"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install

Use a Node.js version supported by the current&nbsp;[OpenClaw installation guide](https://docs.openclaw.ai/install). The recorded version requires Node 24.16+ or 26.1+.

```bash
pnpm add -g openclaw
openclaw --version
```

## Configure the provider

Export a key from the workspace you want to use:

```bash
export LLMGATEWAY_API_KEY="your_api_key"
```

Merge this provider into `~/.openclaw/openclaw.json`. Replace `MODEL_ID`, the display name, and the example limits with values for your chosen model from the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools).

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "llmgateway": {
        "baseUrl": "https://api.llmgateway.io/v1",
        "apiKey": "${LLMGATEWAY_API_KEY}",
        "api": "openai-completions",
        "models": [
          {
            "id": "MODEL_ID",
            "name": "Gateway coding model",
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "llmgateway/MODEL_ID" }
    }
  }
}
```

`llmgateway/` in the primary model names OpenClaw's local provider entry. The nested `id` is the model identifier sent to LLM Gateway.

With a&nbsp;[DevPass](https://devpass.llmgateway.io) key, retain OpenClaw's local `llmgateway/` prefix and use a canonical model ID included in your plan. Do not add an upstream provider prefix inside the nested model ID.

## Verify a local agent task

From a small project you can review, run:

```bash
openclaw agent exec   --config ~/.openclaw/openclaw.json   --cwd .   --code-mode direct   "Read the failing test, fix the implementation, and run the tests. Do not change the tests or use subagents."
```

`agent exec` runs one agent turn without a running OpenClaw gateway. It can execute commands and change files in the selected workspace, so use a controlled project. A successful exit alone does not prove the task was completed: inspect the diff and run the tests independently.

For a focused coding workflow, restrict the tool policy in your configuration:

```json
{
  "tools": {
    "profile": "coding",
    "allow": ["read", "write", "edit", "exec", "process"]
  }
}
```

Merge this with your configuration rather than replacing the provider settings. Review the&nbsp;[OpenClaw agent command reference](https://docs.openclaw.ai/cli/agent) for execution policy and isolation options. `--auth-env-only` cannot be combined with `--config`.

## Connect channels after verification

Follow OpenClaw's channel-specific setup for the messaging service you use. Review who can reach the agent and which tools it may call before enabling incoming messages.

Requests use the workspace associated with your gateway key. Review model usage and errors in that workspace's dashboard.

## Troubleshooting

**Startup rejects Node.js:** update to a supported runtime and check the version in the shell launching OpenClaw.

**The model is unavailable:** check the primary provider alias, nested model ID, account access, and catalogue limits.

**The agent only describes a plan:** verify that tools are enabled and the selected model actually returns tool calls. Try a compatible tool-capable model and inspect the resulting file changes; a text-only answer is not evidence of execution.

**A key is missing:** export the environment variable before launching OpenClaw, including when starting it through a service manager.
