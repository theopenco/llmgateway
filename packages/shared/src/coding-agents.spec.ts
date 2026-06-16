import { describe, expect, it } from "vitest";

import {
	isRecognizedCodingAgent,
	normalizeSourceToAgentId,
	getSupportedAgentsList,
} from "./coding-agents.js";

describe("isRecognizedCodingAgent", () => {
	it("recognizes all explicit agent source values", () => {
		expect(isRecognizedCodingAgent("claude.com/claude-code")).toBe(true);
		expect(isRecognizedCodingAgent("codex")).toBe(true);
		expect(isRecognizedCodingAgent("opencode")).toBe(true);
		expect(isRecognizedCodingAgent("open-code")).toBe(true);
		expect(isRecognizedCodingAgent("cline")).toBe(true);
		expect(isRecognizedCodingAgent("cursor")).toBe(true);
		expect(isRecognizedCodingAgent("autohand")).toBe(true);
		expect(isRecognizedCodingAgent("soulforge")).toBe(true);
		expect(isRecognizedCodingAgent("n8n")).toBe(true);
		expect(isRecognizedCodingAgent("openclaw")).toBe(true);
		expect(isRecognizedCodingAgent("aider")).toBe(true);
		expect(isRecognizedCodingAgent("continue")).toBe(true);
		expect(isRecognizedCodingAgent("windsurf")).toBe(true);
		expect(isRecognizedCodingAgent("codeium")).toBe(true);
		expect(isRecognizedCodingAgent("roo-code")).toBe(true);
		expect(isRecognizedCodingAgent("roo-cline")).toBe(true);
		expect(isRecognizedCodingAgent("zed")).toBe(true);
		expect(isRecognizedCodingAgent("github-copilot")).toBe(true);
		expect(isRecognizedCodingAgent("copilot")).toBe(true);
		expect(isRecognizedCodingAgent("pi-agent")).toBe(true);
		expect(isRecognizedCodingAgent("hermes-agent")).toBe(true);
		expect(isRecognizedCodingAgent("hermes")).toBe(true);
	});

	it("recognizes *claw forks via pattern", () => {
		expect(isRecognizedCodingAgent("anyclaw")).toBe(true);
		expect(isRecognizedCodingAgent("super-claw")).toBe(true);
		expect(isRecognizedCodingAgent("myclaw-fork")).toBe(true);
		expect(isRecognizedCodingAgent("clawbot")).toBe(true);
	});

	it("rejects unknown sources", () => {
		expect(isRecognizedCodingAgent(undefined)).toBe(false);
		expect(isRecognizedCodingAgent("")).toBe(false);
		expect(isRecognizedCodingAgent("curl")).toBe(false);
		expect(isRecognizedCodingAgent("postman")).toBe(false);
		expect(isRecognizedCodingAgent("chat.llmgateway.io")).toBe(false);
		expect(isRecognizedCodingAgent("my-custom-app")).toBe(false);
	});
});

describe("normalizeSourceToAgentId", () => {
	it("maps alternate x-source values to canonical ID", () => {
		expect(normalizeSourceToAgentId("open-code")).toBe("opencode");
		expect(normalizeSourceToAgentId("codeium")).toBe("windsurf");
		expect(normalizeSourceToAgentId("roo-cline")).toBe("roo-code");
		expect(normalizeSourceToAgentId("copilot")).toBe("github-copilot");
		expect(normalizeSourceToAgentId("hermes")).toBe("hermes-agent");
	});

	it("returns the same value for canonical IDs", () => {
		expect(normalizeSourceToAgentId("opencode")).toBe("opencode");
		expect(normalizeSourceToAgentId("cursor")).toBe("cursor");
		expect(normalizeSourceToAgentId("claude.com/claude-code")).toBe(
			"claude.com/claude-code",
		);
	});

	it("passes through unknown sources unchanged", () => {
		expect(normalizeSourceToAgentId("unknown-tool")).toBe("unknown-tool");
		expect(normalizeSourceToAgentId("my-app")).toBe("my-app");
	});
});

describe("getSupportedAgentsList", () => {
	it("returns a comma-separated list including claw forks", () => {
		const list = getSupportedAgentsList();
		expect(list).toContain("Claude Code");
		expect(list).toContain("OpenCode");
		expect(list).toContain("Aider");
		expect(list).toContain("*claw fork");
	});
});
