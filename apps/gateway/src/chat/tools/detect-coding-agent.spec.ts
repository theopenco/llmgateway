import { describe, expect, it } from "vitest";

import { detectCodingAgentFromUserAgent } from "./detect-coding-agent.js";

describe("detectCodingAgentFromUserAgent", () => {
	it("returns undefined when user agent is missing", () => {
		expect(detectCodingAgentFromUserAgent(undefined)).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("")).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("   ")).toBeUndefined();
	});

	it("detects Claude Code", () => {
		expect(detectCodingAgentFromUserAgent("claude-cli/0.2.31")).toBe(
			"claude.com/claude-code",
		);
		expect(detectCodingAgentFromUserAgent("Claude-CLI/1.0.0 (mac)")).toBe(
			"claude.com/claude-code",
		);
		expect(
			detectCodingAgentFromUserAgent("MyApp/1.0 (claude-code; node)"),
		).toBe("claude.com/claude-code");
	});

	it("detects Codex CLI variants", () => {
		expect(detectCodingAgentFromUserAgent("codex_cli_rs/0.4.2")).toBe("codex");
		expect(detectCodingAgentFromUserAgent("codex-cli/2.1.0")).toBe("codex");
		expect(detectCodingAgentFromUserAgent("codex/3.0.0 node/22")).toBe("codex");
		expect(
			detectCodingAgentFromUserAgent(
				"codex_vscode/0.147.0-alpha.6.5 (Ubuntu 24.4.0; x86_64) unknown (VS Code; 26.803.41515)",
			),
		).toBe("codex");
		expect(
			detectCodingAgentFromUserAgent(
				"codex_exec/0.66.0 (Ubuntu 24.4.0; x86_64)",
			),
		).toBe("codex");
	});

	it("detects OpenCode", () => {
		expect(detectCodingAgentFromUserAgent("opencode/0.5.1")).toBe("opencode");
		expect(detectCodingAgentFromUserAgent("OpenCode/2.0 (linux)")).toBe(
			"opencode",
		);
	});

	it("detects Cline", () => {
		expect(detectCodingAgentFromUserAgent("Cline-VSCode/3.4.0")).toBe("cline");
		expect(detectCodingAgentFromUserAgent("vscode-extension cline")).toBe(
			"cline",
		);
	});

	it("detects Cursor", () => {
		expect(detectCodingAgentFromUserAgent("Cursor/0.45.0")).toBe("cursor");
		expect(detectCodingAgentFromUserAgent("cursor-llm/1.0")).toBe("cursor");
	});

	it("detects Autohand", () => {
		expect(detectCodingAgentFromUserAgent("autohand/1.0.0")).toBe("autohand");
		expect(detectCodingAgentFromUserAgent("autohand-code/2.0")).toBe(
			"autohand",
		);
	});

	it("detects Empryo", () => {
		expect(detectCodingAgentFromUserAgent("empryo/1.0.0")).toBe("empryo");
	});

	it("detects SoulForge", () => {
		expect(detectCodingAgentFromUserAgent("soulforge/0.9.0")).toBe("soulforge");
	});

	it("detects n8n", () => {
		expect(detectCodingAgentFromUserAgent("n8n/1.50.0")).toBe("n8n");
		expect(detectCodingAgentFromUserAgent("n8n-workflow runner")).toBe("n8n");
		expect(detectCodingAgentFromUserAgent("n8n")).toBe("n8n");
	});

	it("detects OpenClaw", () => {
		expect(detectCodingAgentFromUserAgent("openclaw/0.1.0")).toBe("openclaw");
	});

	it("detects Aider", () => {
		expect(detectCodingAgentFromUserAgent("aider/0.50.0")).toBe("aider");
		expect(detectCodingAgentFromUserAgent("Aider/1.0 (python)")).toBe("aider");
	});

	it("detects Continue", () => {
		expect(detectCodingAgentFromUserAgent("continue/1.2.0")).toBe("continue");
		expect(detectCodingAgentFromUserAgent("continue-dev/0.8.0")).toBe(
			"continue",
		);
	});

	it("detects Windsurf/Codeium", () => {
		expect(detectCodingAgentFromUserAgent("windsurf/1.0.0")).toBe("windsurf");
		expect(detectCodingAgentFromUserAgent("codeium/2.0.0")).toBe("windsurf");
		expect(detectCodingAgentFromUserAgent("VSCode (windsurf extension)")).toBe(
			"windsurf",
		);
	});

	it("detects Roo Code", () => {
		expect(detectCodingAgentFromUserAgent("roo-code/1.0")).toBe("roo-code");
		expect(detectCodingAgentFromUserAgent("roo_code/2.0")).toBe("roo-code");
		expect(detectCodingAgentFromUserAgent("roo-cline/3.0")).toBe("roo-code");
	});

	it("detects Zed AI", () => {
		expect(detectCodingAgentFromUserAgent("Zed/0.150.0")).toBe("zed");
		expect(detectCodingAgentFromUserAgent("zed-editor/1.0")).toBe("zed");
	});

	it("detects GitHub Copilot", () => {
		expect(detectCodingAgentFromUserAgent("github-copilot/1.0")).toBe(
			"github-copilot",
		);
		expect(detectCodingAgentFromUserAgent("VSCode copilot extension")).toBe(
			"github-copilot",
		);
		// Real BYOK User-Agents: camel-cased, no word boundary around "copilot"
		expect(detectCodingAgentFromUserAgent("GitHubCopilotChat/0.26.7")).toBe(
			"github-copilot",
		);
		expect(detectCodingAgentFromUserAgent("GithubCopilot/1.155.0")).toBe(
			"github-copilot",
		);
		expect(detectCodingAgentFromUserAgent("GitHubCopilotCLI/0.1.0")).toBe(
			"github-copilot",
		);
		expect(detectCodingAgentFromUserAgent("copilot-cli/1.0.0")).toBe(
			"github-copilot",
		);
	});

	it("detects Pi Agent", () => {
		expect(detectCodingAgentFromUserAgent("pi-agent/1.0.0")).toBe("pi-agent");
		expect(detectCodingAgentFromUserAgent("pi_agent/2.0")).toBe("pi-agent");
		expect(detectCodingAgentFromUserAgent("pi-coding-agent")).toBe("pi-agent");
	});

	it("detects Crush", () => {
		expect(
			detectCodingAgentFromUserAgent(
				"Charm-Crush/v0.87.0 (https://charm.land/crush)",
			),
		).toBe("crush");
		expect(detectCodingAgentFromUserAgent("crush/0.88.0")).toBe("crush");
	});

	it("detects Kimi Code", () => {
		expect(detectCodingAgentFromUserAgent("kimi-code-cli/0.34.0")).toBe(
			"kimi-code",
		);
		expect(detectCodingAgentFromUserAgent("kimi-cli/1.0.0")).toBe("kimi-code");
	});

	it("detects Qwen Code", () => {
		expect(detectCodingAgentFromUserAgent("QwenCode/0.21.5 (linux; x64)")).toBe(
			"qwen-code",
		);
		expect(detectCodingAgentFromUserAgent("qwen-code/1.0")).toBe("qwen-code");
	});

	it("detects Factory Droid", () => {
		expect(detectCodingAgentFromUserAgent("factory-cli/0.190.0")).toBe(
			"factory-droid",
		);
		expect(detectCodingAgentFromUserAgent("droid/1.2.3")).toBe("factory-droid");
	});

	it("detects MiMo Code", () => {
		expect(detectCodingAgentFromUserAgent("mimocode")).toBe("mimo-code");
		expect(detectCodingAgentFromUserAgent("mimocode/1.4.0")).toBe("mimo-code");
		expect(detectCodingAgentFromUserAgent("mimo-code/2.0")).toBe("mimo-code");
	});

	it("detects Traycer", () => {
		expect(detectCodingAgentFromUserAgent("traycer-agents/1.9.0")).toBe(
			"traycer",
		);
		expect(detectCodingAgentFromUserAgent("Traycer/2.0 (vscode)")).toBe(
			"traycer",
		);
	});

	it("detects Foundry Toolkit", () => {
		expect(detectCodingAgentFromUserAgent("windows-ai-studio/0.15.2")).toBe(
			"foundry-toolkit",
		);
		expect(detectCodingAgentFromUserAgent("foundry-toolkit/1.0.0")).toBe(
			"foundry-toolkit",
		);
	});

	it("detects Hermes Agent", () => {
		expect(detectCodingAgentFromUserAgent("hermes-agent/0.5.0")).toBe(
			"hermes-agent",
		);
		expect(detectCodingAgentFromUserAgent("hermes_agent/1.0")).toBe(
			"hermes-agent",
		);
	});

	it("detects *claw forks", () => {
		expect(detectCodingAgentFromUserAgent("myclaw/1.0")).toBe("myclaw");
		expect(detectCodingAgentFromUserAgent("super-claw/2.0")).toBe("super-claw");
		expect(detectCodingAgentFromUserAgent("anyclaw-tool/0.1")).toBe(
			"anyclaw-tool",
		);
	});

	it("does not classify unrelated user agents", () => {
		expect(
			detectCodingAgentFromUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			),
		).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("curl/8.4.0")).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("axios/1.6.5")).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("python-requests/2.31"),
		).toBeUndefined();
	});

	it("leaves generic SDKs and proxies unattributed", () => {
		expect(
			detectCodingAgentFromUserAgent(
				"ai/6.0.168 ai-sdk/provider-utils/4.0.23 runtime/node.js/26",
			),
		).toBeUndefined();
		// Every OpenAI SDK variant, not just the async one: the SDK is only ever
		// attributed via an explicit x-source, never via its User-Agent.
		expect(
			detectCodingAgentFromUserAgent("OpenAI/Python 2.32.0"),
		).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("AsyncOpenAI/Python 2.32.0"),
		).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("OpenAI/JS 6.47.0")).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("Anthropic/Python 0.75.0"),
		).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("litellm/1.90.1")).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("cli-proxy-openai-compat"),
		).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent(
				"langchainjs-openai/1.0.0 ((node/v24.16.0; linux; x64))",
			),
		).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("spring-ai-openai/1.0.0"),
		).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("tauri-plugin-http/2.4.0"),
		).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("Go-http-client/2.0"),
		).toBeUndefined();
		expect(
			detectCodingAgentFromUserAgent("RikkaHub-Android/1.8.0"),
		).toBeUndefined();
	});
});
