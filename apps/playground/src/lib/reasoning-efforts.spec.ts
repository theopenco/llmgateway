import { describe, expect, it } from "vitest";

import { getReasoningEffortOptions } from "./reasoning-efforts";

describe("getReasoningEffortOptions", () => {
	it("returns the full anthropic tier list including xhigh and max", () => {
		expect(
			getReasoningEffortOptions("claude-opus-4-8", "anthropic", ["anthropic"]),
		).toEqual(["low", "medium", "high", "xhigh", "max"]);
		expect(
			getReasoningEffortOptions("claude-sonnet-4-6", "anthropic", [
				"anthropic",
				"aws-bedrock",
			]),
		).toEqual(["low", "medium", "high", "xhigh", "max"]);
	});

	it("includes none and minimal for Gemini API models", () => {
		expect(
			getReasoningEffortOptions("gemini-3.5-flash", "google", [
				"google-ai-studio",
				"google-vertex",
			]),
		).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
	});

	it("uses the default set for Gemma on generic hosts", () => {
		expect(
			getReasoningEffortOptions("gemma-4-31b-it", "google", [
				"deepinfra",
				"together-ai",
				"cerebras",
			]),
		).toEqual(["low", "medium", "high"]);
	});

	it("keeps minimal for the original GPT-5 line without xhigh", () => {
		expect(getReasoningEffortOptions("gpt-5.1", "openai", ["openai"])).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
		]);
		expect(getReasoningEffortOptions("gpt-5.2", "openai", ["openai"])).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
		]);
	});

	it("replaces minimal with none and adds xhigh for GPT-5.4+", () => {
		for (const id of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol"]) {
			expect(getReasoningEffortOptions(id, "openai", ["openai"])).toEqual([
				"none",
				"low",
				"medium",
				"high",
				"xhigh",
			]);
		}
	});

	it("restricts pro variants", () => {
		expect(
			getReasoningEffortOptions("gpt-5.2-pro", "openai", ["openai"]),
		).toEqual(["high"]);
		expect(
			getReasoningEffortOptions("gpt-5.4-pro", "openai", ["openai"]),
		).toEqual(["medium", "high", "xhigh"]);
		expect(
			getReasoningEffortOptions("gpt-5.5-pro", "openai", ["openai"]),
		).toEqual(["medium", "high", "xhigh"]);
	});

	it("uses the default set for o-series, gpt-oss and codex models", () => {
		for (const id of ["o1", "o4-mini", "gpt-oss-120b", "gpt-5.3-codex"]) {
			expect(getReasoningEffortOptions(id, "openai", ["openai"])).toEqual([
				"low",
				"medium",
				"high",
			]);
		}
	});

	it("only offers high and xhigh for Fugu", () => {
		expect(
			getReasoningEffortOptions("fugu-ultra", "sakana", ["sakana"]),
		).toEqual(["high", "xhigh"]);
	});

	it("falls back to low/medium/high for other families", () => {
		expect(getReasoningEffortOptions("glm-5.2", "zai", ["zai"])).toEqual([
			"low",
			"medium",
			"high",
		]);
		expect(
			getReasoningEffortOptions("deepseek-v4-pro", "deepseek", ["deepseek"]),
		).toEqual(["low", "medium", "high"]);
	});
});
