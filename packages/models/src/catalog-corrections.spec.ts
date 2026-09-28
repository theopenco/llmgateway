import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import { expandAllProviderRegions } from "./region-helpers.js";

import type { ModelDefinition } from "./models.js";

function mapping(modelId: string, providerId: string, region?: string) {
	const model = (models as readonly ModelDefinition[]).find(
		(entry) => entry.id === modelId,
	)!;
	return expandAllProviderRegions(model.providers).find(
		(entry) => entry.providerId === providerId && entry.region === region,
	)!;
}

describe("documented catalogue corrections", () => {
	it("exposes the Beijing long-context window", () => {
		expect(mapping("qwen-plus", "alibaba", "cn-beijing").contextSize).toBe(
			1_000_000,
		);
	});
	it.each(["mistral-large-latest", "mistral-large-2512"])(
		"preserves large-model tool support: %s",
		(model) => {
			expect(mapping(model, "mistral")).toMatchObject({
				contextSize: 262144,
				inputPrice: "0.5e-6",
				outputPrice: "1.5e-6",
				tools: true,
			});
		},
	);
	it("models both MiniMax long-context price bands", () => {
		const provider = mapping("minimax-m3", "minimax");
		expect(provider.contextSize).toBe(1_000_000);
		expect(provider.pricingTiers).toHaveLength(2);
		expect(provider.pricingTiers?.[0]).toMatchObject({
			upToTokens: 512000,
			inputPrice: "0.3e-6",
		});
		expect(provider.pricingTiers?.[1]).toMatchObject({
			inputPrice: "0.6e-6",
			outputPrice: "2.4e-6",
		});
	});
	it.each([
		["muse-spark-1.3", "meta"],
		["muse-spark-1.3-contributor", "meta-contributor"],
	])(
		"exposes max reasoning and the full temperature range for %s",
		(model, provider) => {
			expect(mapping(model, provider).reasoningEfforts).toContain("max");
			expect(mapping(model, provider).maxTemperature).toBe(2);
		},
	);
});
