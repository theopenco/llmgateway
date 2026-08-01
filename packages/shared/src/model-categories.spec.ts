import { describe, expect, it } from "vitest";

import {
	getModelCategory,
	isPremiumModel,
	isPremiumUsedModel,
} from "./model-categories.js";

describe("model-categories", () => {
	it("classifies a known premium model as premium", () => {
		expect(isPremiumModel("claude-opus-4-5-20251101")).toBe(true);
		expect(getModelCategory("claude-opus-4-5-20251101")).toBe("premium");
	});

	it("classifies all catalog Opus models as premium", () => {
		for (const modelId of [
			"claude-3-opus",
			"claude-opus-4-20250514",
			"claude-opus-4-1-20250805",
			"claude-opus-4-5-20251101",
			"claude-opus-4-6",
			"claude-opus-4-7",
			"claude-opus-4-8",
		]) {
			expect(isPremiumModel(modelId)).toBe(true);
			expect(getModelCategory(modelId)).toBe("premium");
		}
	});

	it("classifies an unknown model as standard", () => {
		expect(isPremiumModel("some-non-existent-model")).toBe(false);
		expect(getModelCategory("some-non-existent-model")).toBe("standard");
	});

	it("classifies a known standard model as standard", () => {
		expect(isPremiumModel("gpt-4o-mini")).toBe(false);
		expect(getModelCategory("gpt-4o-mini")).toBe("standard");
	});

	it("classifies provider-prefixed usedModel values as premium", () => {
		expect(isPremiumUsedModel("anthropic/claude-fable-5")).toBe(true);
		expect(isPremiumUsedModel("anthropic/claude-opus-4-8")).toBe(true);
	});

	it("classifies region-suffixed usedModel values as premium", () => {
		expect(isPremiumUsedModel("aws-bedrock/claude-fable-5:global")).toBe(true);
		expect(isPremiumUsedModel("aws-bedrock/claude-fable-5:us")).toBe(true);
	});

	it("classifies standard usedModel values as standard", () => {
		expect(isPremiumUsedModel("openai/gpt-4o-mini")).toBe(false);
		expect(isPremiumUsedModel("custom/some-unknown-model")).toBe(false);
	});

	it("accepts a bare model id in usedModel form", () => {
		expect(isPremiumUsedModel("claude-fable-5")).toBe(true);
		expect(isPremiumUsedModel("gpt-4o-mini")).toBe(false);
	});
});
