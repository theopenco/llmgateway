import { describe, expect, it } from "vitest";

import { detectCodingAgentFromUserAgent } from "./detect-coding-agent.js";

describe("detectCodingAgentFromUserAgent", () => {
	it("returns undefined when user agent is missing", () => {
		expect(detectCodingAgentFromUserAgent(undefined)).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("")).toBeUndefined();
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

	it("detects SoulForge", () => {
		expect(detectCodingAgentFromUserAgent("soulforge/0.9.0")).toBe("soulforge");
	});

	it("detects n8n", () => {
		expect(detectCodingAgentFromUserAgent("n8n/1.50.0")).toBe("n8n");
		expect(detectCodingAgentFromUserAgent("n8n-workflow runner")).toBe("n8n");
	});

	it("detects OpenClaw", () => {
		expect(detectCodingAgentFromUserAgent("openclaw/0.1.0")).toBe("openclaw");
	});

	it("does not classify unrelated user agents", () => {
		expect(
			detectCodingAgentFromUserAgent(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
			),
		).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("curl/8.4.0")).toBeUndefined();
		expect(detectCodingAgentFromUserAgent("axios/1.6.5")).toBeUndefined();
	});
});
