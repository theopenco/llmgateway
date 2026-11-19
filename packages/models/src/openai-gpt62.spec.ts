import { describe, expect, it } from "vitest";

import { supportsOpenAIExplicitPromptCache } from "./helpers.js";
import { models } from "./models.js";

const cases = [
	{
		id: "gpt-6.2-sol",
		name: "GPT-6.2 Sol",
		short: ["2.0e-6", "10.0e-6", "0.1e-6", "2.5e-6"],
		long: ["4.0e-6", "15.0e-6", "0.2e-6", "5.0e-6"],
	},
	{
		id: "gpt-6.2-astra",
		name: "GPT-6.2 Astra",
		short: ["8.0e-6", "40.0e-6", "0.4e-6", "10.0e-6"],
		long: ["16.0e-6", "60.0e-6", "0.8e-6", "20.0e-6"],
	},
] as const;

function rates([input, output, cached, cacheWrite]: readonly string[]) {
	return {
		inputPrice: input,
		outputPrice: output,
		cachedInputPrice: cached,
		cacheWriteInputPrice: cacheWrite,
	};
}

describe.each(cases)("$name", ({ id, name, short, long }) => {
	const model = models.find((entry) => entry.id === id);
	const mapping = model?.providers.find(
		(entry) => entry.providerId === "openai",
	);

	it("routes supported capabilities through the Responses API", () => {
		expect(model).toMatchObject({ name, family: "openai" });
		expect(mapping).toMatchObject({
			externalId: id,
			contextSize: 1050000,
			maxOutput: 128000,
			streaming: true,
			vision: true,
			tools: true,
			supportsResponsesApi: true,
			jsonOutput: true,
			jsonOutputSchema: true,
			reasoning: true,
			reasoningOutput: "omit",
			reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
			reasoningModes: ["standard", "pro"],
			supportedToolChoices: ["auto", "none", "required", "function"],
			serviceTiers: ["priority"],
			serviceTierMultipliers: { priority: 2 },
		});
	});

	it("uses the published short- and long-context cache rates", () => {
		expect(mapping).toMatchObject({
			...rates(short),
			pricingTiers: [
				{ upToTokens: 272000, ...rates(short) },
				{ upToTokens: Infinity, ...rates(long) },
			],
		});
		expect(supportsOpenAIExplicitPromptCache(id)).toBe(true);
	});
});

describe.each(cases)("$name on Azure", ({ id, short, long }) => {
	const mapping = models
		.find((entry) => entry.id === id)
		?.providers.find((entry) => entry.providerId === "azure");

	it("mirrors the OpenAI capabilities and prices without service tiers", () => {
		expect(mapping).toMatchObject({
			externalId: id,
			test: "skip",
			contextSize: 1050000,
			maxOutput: 128000,
			supportsResponsesApi: true,
			reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
			...rates(short),
			pricingTiers: [
				{ upToTokens: 272000, ...rates(short) },
				{ upToTokens: Infinity, ...rates(long) },
			],
		});
		expect(mapping).not.toHaveProperty("serviceTiers");
		expect(mapping).not.toHaveProperty("reasoningModes");
	});
});
