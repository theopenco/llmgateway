import { describe, expect, it } from "vitest";

import { pickAutoReasoningEffort } from "./pick-auto-reasoning-effort.js";

describe("pickAutoReasoningEffort", () => {
	it("keeps minimal for gpt-5 mappings that support it", () => {
		expect(
			pickAutoReasoningEffort("gpt-5-mini", [
				"minimal",
				"low",
				"medium",
				"high",
			]),
		).toBe("minimal");
	});

	it("falls back to none when the mapping dropped minimal", () => {
		expect(
			pickAutoReasoningEffort("gpt-5.4-mini", [
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
			]),
		).toBe("none");
	});

	it("falls back to low when the mapping has neither minimal nor none", () => {
		expect(
			pickAutoReasoningEffort("gpt-5.2-codex", [
				"low",
				"medium",
				"high",
				"xhigh",
			]),
		).toBe("low");
	});

	it("sets nothing when no preferred effort is supported", () => {
		expect(
			pickAutoReasoningEffort("gpt-5.2-pro", ["medium", "high", "xhigh"]),
		).toBeUndefined();
		expect(pickAutoReasoningEffort("gpt-5-pro", ["high"])).toBeUndefined();
	});

	it("uses low for non-gpt-5 models", () => {
		expect(
			pickAutoReasoningEffort("claude-opus-4.5", ["low", "medium", "high"]),
		).toBe("low");
	});

	it("keeps the previous default when the mapping declares no efforts", () => {
		expect(pickAutoReasoningEffort("gpt-5-mini", undefined)).toBe("minimal");
		expect(pickAutoReasoningEffort("claude-opus-4.5", undefined)).toBe("low");
	});
});
