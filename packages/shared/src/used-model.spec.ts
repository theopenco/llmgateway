import { describe, expect, it } from "vitest";

import { parseUsedModel, regionFromUsedModel } from "./used-model.js";

describe("parseUsedModel", () => {
	it("splits the provider prefix and region suffix", () => {
		expect(parseUsedModel("alibaba/glm-4.6:cn-beijing", "alibaba")).toEqual({
			modelId: "glm-4.6",
			region: "cn-beijing",
		});
	});

	it("returns a null region for providers without regional deployments", () => {
		expect(parseUsedModel("openai/gpt-5-nano", "openai")).toEqual({
			modelId: "gpt-5-nano",
			region: null,
		});
	});

	it("strips a mismatched provider prefix", () => {
		expect(parseUsedModel("alibaba/qwen-plus:us-virginia", "openai")).toEqual({
			modelId: "qwen-plus",
			region: "us-virginia",
		});
	});

	it("works without a provider hint", () => {
		expect(parseUsedModel("aws-bedrock/claude-sonnet-5:global")).toEqual({
			modelId: "claude-sonnet-5",
			region: "global",
		});
	});

	it("keeps a bare model id intact", () => {
		expect(parseUsedModel("gpt-5-nano", "openai")).toEqual({
			modelId: "gpt-5-nano",
			region: null,
		});
	});

	it("splits on the last colon so versioned ids survive", () => {
		expect(
			parseUsedModel("google-vertex/gemini-3:preview:us-central1"),
		).toEqual({
			modelId: "gemini-3:preview",
			region: "us-central1",
		});
	});
});

describe("regionFromUsedModel", () => {
	it("returns the region", () => {
		expect(
			regionFromUsedModel("alibaba/qwen-plus:us-virginia", "alibaba"),
		).toBe("us-virginia");
	});

	it("returns null for empty or missing values", () => {
		expect(regionFromUsedModel("")).toBeNull();
		expect(regionFromUsedModel(null)).toBeNull();
		expect(regionFromUsedModel(undefined)).toBeNull();
	});
});
