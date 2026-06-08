import { describe, expect, it } from "vitest";

import {
	getModelCategory,
	isPremiumModel,
	PREMIUM_MODEL_IDS,
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

	it("has a non-empty premium set", () => {
		expect(PREMIUM_MODEL_IDS.size).toBeGreaterThan(0);
	});
});
