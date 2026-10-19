---
id: kimi-code
slug: kimi-code
title: Kimi Code Integration
seoTitle: Install Kimi Code and use it with LLM Gateway
description: Install Kimi Code on macOS, Linux or Windows (curl or irm one-liners), connect it to LLM Gateway or DevPass, discover models, and verify a coding task.
date: 2026-10-11
---

[Kimi Code](https://github.com/MoonshotAI/kimi-code) is a terminal coding agent. Its provider manager can discover LLM Gateway models and save the connection for future sessions.

## Video walkthrough

<div className="relative aspect-video">
	<iframe
		className="absolute inset-0 h-full w-full rounded-lg border-0"
		src="https://www.youtube-nocookie.com/embed/BhJPdUAXhpE"
		title="Kimi Code setup and coding demo with LLM Gateway"
		loading="lazy"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		referrerPolicy="strict-origin-when-cross-origin"
		allowFullScreen
	></iframe>
</div>

## Install Kimi Code

The official install script needs no Node.js. It downloads the latest release, verifies the checksum and puts the `kimi` binary on your `PATH`.

**macOS / Linux**

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://code.kimi.com/kimi-code/install.ps1 | iex
```

On Windows, install [Git for Windows](https://gitforwindows.org/) before the first launch: Kimi Code uses the bundled Git Bash as its shell. If Git Bash lives somewhere else, set `KIMI_SHELL_PATH` to the full path of `bash.exe`.

Pin a version with `KIMI_VERSION=0.5.0` (or `--version 0.5.0` on the shell script), change the install directory with `KIMI_INSTALL_DIR`, or skip the `PATH` change with `KIMI_NO_MODIFY_PATH=1`.

**npm (Node.js 22.19 or later)**

```bash
npm install -g @moonshot-ai/kimi-code
# or
pnpm add -g @moonshot-ai/kimi-code
```

Then check the binary and, later, upgrade in place:

```bash
kimi --version
kimi upgrade
```

Full options are in the [Kimi Code getting-started guide](https://moonshotai.github.io/kimi-code/en/guides/getting-started).

## Connect your account

Create an API key in your LLM Gateway or DevPass dashboard, then launch `kimi` from your project. Review the workspace trust prompt before continuing.

1. Run `/provider`.
2. Select **Add New Platform**, then **Known third-party provider**.
3. Search for **LLM Gateway**.
4. Choose **LLM Gateway** for pay-as-you-go usage or **DevPass (LLM Gateway)** for a coding plan.
5. Enter your key when prompted, then choose a tool-capable model.

The provider registry supplies model metadata. Use the&nbsp;[live catalogue](https://llmgateway.io/models?features=tools) to check capabilities and account availability.

> **Using DevPass?** Choose a canonical model ID included in your plan. An upstream provider prefix pins routing and is not supported by coding plans. A local provider name in Kimi's model alias is separate from the model ID sent to the gateway.

## Verify a small task

Ask Kimi to inspect a function, fix one failing test case, and run the existing tests without changing them. Review the diff and command output. Use `/model` to change the selected model for later work.

The key determines which workspace receives the requests. Check usage in that workspace's dashboard.

## Manual configuration

Kimi stores its configuration in `~/.kimi-code/config.toml`. A custom OpenAI-compatible provider uses `type = "openai"` and `base_url = "https://api.llmgateway.io/v1"`. Keep the file private because it can contain your API key.

Model entries refer to the local provider name and specify the gateway model ID. Match their context limits, output limits, and capabilities to the selected model. Prefer the provider manager when you want the registry to populate those values.

## Troubleshooting

**The provider list is unavailable:** check network access to the registry or use a custom provider configuration.

**Authentication fails:** check that the key is active and belongs to the intended workspace.

**A model is unavailable:** verify its exact ID and that your account or plan can use it.

**Tool calls fail:** choose a model with tool support and check the model metadata in your configuration.
