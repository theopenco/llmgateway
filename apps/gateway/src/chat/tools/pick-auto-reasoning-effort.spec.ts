import { describe, expect, it } from "vitest";

import {
	pickAutoReasoningEffort,
	pickFallbackReasoningEffort,
} from "./pick-auto-reasoning-effort.js";

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

	it("uses medium for the medium tier when supported", () => {
		expect(
			pickAutoReasoningEffort(
				"gpt-5-mini",
				["minimal", "low", "medium"],
				"medium",
			),
		).toBe("medium");
		expect(
			pickAutoReasoningEffort("claude-opus-4.5", undefined, "medium"),
		).toBe("medium");
	});

	it("uses high for the high tier, clamping to medium", () => {
		expect(
			pickAutoReasoningEffort(
				"claude-opus-4.5",
				["low", "medium", "high"],
				"high",
			),
		).toBe("high");
		expect(
			pickAutoReasoningEffort(
				"gpt-5-mini",
				["minimal", "low", "medium"],
				"high",
			),
		).toBe("medium");
	});

	it("sets nothing for the medium tier when medium is unsupported", () => {
		expect(
			pickAutoReasoningEffort("gpt-5-pro", ["high", "xhigh"], "medium"),
		).toBeUndefined();
	});

	it("keeps the previous default when the mapping declares no efforts", () => {
		expect(pickAutoReasoningEffort("gpt-5-mini", undefined)).toBe("minimal");
		expect(pickAutoReasoningEffort("claude-opus-4.5", undefined)).toBe("low");
	});
});

describe("pickFallbackReasoningEffort", () => {
	it("re-picks an auto effort against the fallback mapping", () => {
		expect(
			pickFallbackReasoningEffort(
				"low",
				{ modelId: "glm-5.3", effortTier: "low" },
				["xhigh", "max"],
			),
		).toBeUndefined();
		expect(
			pickFallbackReasoningEffort(
				"minimal",
				{ modelId: "gpt-5.4-mini", effortTier: "low" },
				["none", "low", "medium"],
			),
		).toBe("none");
	});

	it("keeps the routed effort tier when re-picking", () => {
		expect(
			pickFallbackReasoningEffort(
				"high",
				{ modelId: "glm-5.3", effortTier: "high" },
				["medium", "xhigh"],
			),
		).toBe("medium");
		expect(
			pickFallbackReasoningEffort(
				"medium",
				{ modelId: "glm-5.3", effortTier: "medium" },
				["low", "medium"],
			),
		).toBe("medium");
	});

	it("keeps an explicit caller effort unchanged", () => {
		expect(
			pickFallbackReasoningEffort("low", undefined, ["xhigh", "max"]),
		).toBe("low");
		expect(
			pickFallbackReasoningEffort(undefined, undefined, ["low"]),
		).toBeUndefined();
	});
});
