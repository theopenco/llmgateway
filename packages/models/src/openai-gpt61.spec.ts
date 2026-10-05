import { describe, expect, it } from "vitest";

import { supportsOpenAIExplicitPromptCache } from "./helpers.js";
import { models } from "./models.js";

describe("GPT-6.1 Sol", () => {
	const model = models.find((entry) => entry.id === "gpt-6.1-sol");
	const mapping = model?.providers.find(
		(entry) => entry.providerId === "openai",
	);

	it("routes supported capabilities through the Responses API", () => {
		expect(model).toMatchObject({ name: "GPT-6.1 Sol", family: "openai" });
		expect(mapping).toMatchObject({
			externalId: "gpt-6.1-sol",
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
			supportedToolChoices: ["auto", "none", "required", "function"],
			serviceTiers: ["flex", "priority"],
			serviceTierMultipliers: { priority: 2 },
		});
	});

	it("uses the published short- and long-context cache rates", () => {
		expect(mapping).toMatchObject({
			inputPrice: "2.0e-6",
			outputPrice: "10.0e-6",
			cachedInputPrice: "0.1e-6",
			cacheWriteInputPrice: "2.5e-6",
			pricingTiers: [
				{
					upToTokens: 272000,
					inputPrice: "2.0e-6",
					outputPrice: "10.0e-6",
					cachedInputPrice: "0.1e-6",
					cacheWriteInputPrice: "2.5e-6",
				},
				{
					upToTokens: Infinity,
					inputPrice: "4.0e-6",
					outputPrice: "15.0e-6",
					cachedInputPrice: "0.2e-6",
					cacheWriteInputPrice: "5.0e-6",
				},
			],
		});
		expect(supportsOpenAIExplicitPromptCache("gpt-6.1-sol")).toBe(true);
	});

	it("mirrors the Global Standard rates on Azure", () => {
		const azure = model?.providers.find(
			(entry) => entry.providerId === "azure",
		);
		expect(azure).toMatchObject({
			externalId: "gpt-6.1-sol",
			contextSize: 1050000,
			maxOutput: 128000,
			supportsResponsesApi: true,
			reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
			inputPrice: "2.0e-6",
			outputPrice: "10.0e-6",
			cachedInputPrice: "0.1e-6",
			cacheWriteInputPrice: "2.5e-6",
			pricingTiers: [
				{
					upToTokens: 272000,
					inputPrice: "2.0e-6",
					outputPrice: "10.0e-6",
					cachedInputPrice: "0.1e-6",
					cacheWriteInputPrice: "2.5e-6",
				},
				{
					upToTokens: Infinity,
					inputPrice: "4.0e-6",
					outputPrice: "15.0e-6",
					cachedInputPrice: "0.2e-6",
					cacheWriteInputPrice: "5.0e-6",
				},
			],
		});
		expect(azure).not.toHaveProperty("serviceTiers");
	});
});
