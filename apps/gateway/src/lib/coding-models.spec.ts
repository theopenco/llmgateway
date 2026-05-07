import { describe, expect, it } from "vitest";

import { isCodingModel, providerSupportsCachedInput } from "./coding-models.js";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

const baseProvider: ProviderModelMapping = {
	providerId: "openai",
	modelName: "test-model",
	streaming: true,
	tools: true,
	jsonOutputSchema: true,
	cachedInputPrice: 0.1 / 1e6,
};

const baseModel: ModelDefinition = {
	id: "test-model",
	name: "Test Model",
	family: "openai",
	providers: [baseProvider],
};

describe("providerSupportsCachedInput", () => {
	it("returns true when cachedInputPrice is set to a positive number", () => {
		expect(providerSupportsCachedInput({ cachedInputPrice: 0.1 / 1e6 })).toBe(
			true,
		);
	});

	it("returns true when cachedInputPrice is zero", () => {
		expect(providerSupportsCachedInput({ cachedInputPrice: 0 })).toBe(true);
	});

	it("returns false when cachedInputPrice is undefined", () => {
		expect(providerSupportsCachedInput({})).toBe(false);
	});

	it("returns false when cachedInputPrice is null", () => {
		expect(
			providerSupportsCachedInput({
				cachedInputPrice: null as unknown as undefined,
			}),
		).toBe(false);
	});
});

describe("isCodingModel", () => {
	it("returns true when at least one stable provider has cached pricing, tools, JSON output, and streaming", () => {
		expect(isCodingModel(baseModel)).toBe(true);
	});

	it("returns false when free", () => {
		expect(isCodingModel({ ...baseModel, free: true })).toBe(false);
	});

	it("returns false when stability is unstable", () => {
		expect(isCodingModel({ ...baseModel, stability: "unstable" })).toBe(false);
	});

	it("returns false when no provider has cached input pricing", () => {
		const provider = { ...baseProvider };
		delete provider.cachedInputPrice;
		expect(isCodingModel({ ...baseModel, providers: [provider] })).toBe(false);
	});

	it("returns false when the only cached provider is unstable", () => {
		const provider: ProviderModelMapping = {
			...baseProvider,
			stability: "unstable",
		};
		expect(isCodingModel({ ...baseModel, providers: [provider] })).toBe(false);
	});

	it("returns false when no provider supports tools", () => {
		const provider: ProviderModelMapping = { ...baseProvider, tools: false };
		expect(isCodingModel({ ...baseModel, providers: [provider] })).toBe(false);
	});

	it("returns false when no provider supports JSON output", () => {
		const provider: ProviderModelMapping = {
			...baseProvider,
			jsonOutput: false,
			jsonOutputSchema: false,
		};
		expect(isCodingModel({ ...baseModel, providers: [provider] })).toBe(false);
	});

	it("returns false when streaming is explicitly disabled", () => {
		const provider: ProviderModelMapping = {
			...baseProvider,
			streaming: false,
		};
		expect(isCodingModel({ ...baseModel, providers: [provider] })).toBe(false);
	});

	it("returns true when at least one provider qualifies even if others do not", () => {
		const cachedProvider = baseProvider;
		const uncachedProvider: ProviderModelMapping = {
			providerId: "groq",
			modelName: "test-model",
			streaming: true,
			tools: true,
			jsonOutputSchema: true,
		};
		expect(
			isCodingModel({
				...baseModel,
				providers: [uncachedProvider, cachedProvider],
			}),
		).toBe(true);
	});
});
