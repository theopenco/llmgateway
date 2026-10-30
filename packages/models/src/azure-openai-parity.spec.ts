import { describe, expect, it } from "vitest";

import { models } from "./models.js";

import type { ModelDefinition } from "./models.js";

describe("Azure OpenAI coverage", () => {
	it("offers GPT-6.1 Terra with Global Standard pricing", () => {
		const mapping = (models as readonly ModelDefinition[])
			.find((model) => model.id === "gpt-6.1-terra")
			?.providers.find((provider) => provider.providerId === "azure");

		expect(mapping).toMatchObject({
			externalId: "gpt-6.1-terra",
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
			reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
			supportedToolChoices: ["auto", "none", "required", "function"],
			inputPrice: "1.0e-6",
			outputPrice: "5.0e-6",
			cachedInputPrice: "0.05e-6",
			cacheWriteInputPrice: "1.25e-6",
			pricingTiers: [
				{
					upToTokens: 272000,
					inputPrice: "1.0e-6",
					outputPrice: "5.0e-6",
					cachedInputPrice: "0.05e-6",
					cacheWriteInputPrice: "1.25e-6",
				},
				{
					upToTokens: Infinity,
					inputPrice: "2.0e-6",
					outputPrice: "7.5e-6",
					cachedInputPrice: "0.1e-6",
					cacheWriteInputPrice: "2.5e-6",
				},
			],
		});
		expect(mapping).not.toHaveProperty("serviceTiers");
		expect(mapping).not.toHaveProperty("deactivatedAt");
	});

	it("offers GPT-5 Pro with Azure's output limit", () => {
		const mapping = (models as readonly ModelDefinition[])
			.find((model) => model.id === "gpt-5-pro")
			?.providers.find((provider) => provider.providerId === "azure");

		expect(mapping).toMatchObject({
			externalId: "gpt-5-pro",
			contextSize: 400000,
			maxOutput: 128000,
			streaming: true,
			vision: true,
			tools: true,
			supportsResponsesApi: true,
			reasoning: true,
			reasoningEfforts: ["high"],
			inputPrice: "15e-6",
			outputPrice: "120e-6",
		});
		expect(mapping).not.toHaveProperty("serviceTiers");
		expect(mapping).not.toHaveProperty("deactivatedAt");
	});
});
