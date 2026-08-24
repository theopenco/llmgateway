import { describe, expect, test } from "vitest";

import {
	applyUseCaseFilter,
	providerRowPassesFilters,
} from "./use-case-filters";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "./api-types";
import type { ProviderRowFilterOptions } from "./use-case-filters";
// Realistic mock mapping: every field the directory renders, with capability
// flags off by default so a test can flip exactly the one it cares about.
function makeMapping(
	overrides: Partial<ApiModelProviderMapping>,
): ApiModelProviderMapping {
	return {
		id: "mapping-1",
		createdAt: "2026-01-01T00:00:00.000Z",
		modelId: "mock-model",
		providerId: "mock-provider",
		externalId: "mock-model",
		region: null,
		inputPrice: "1e-6",
		outputPrice: "3e-6",
		cachedInputPrice: "0.2e-6",
		cacheWriteInputPrice: null,
		cacheWriteInputPrice1h: null,
		imageInputPrice: null,
		imageOutputPrice: null,
		imageInputTokensByResolution: null,
		imageOutputTokensByResolution: null,
		inputCharacterPrice: null,
		outputAudioPrice: null,
		requestPrice: "0",
		contextSize: 128000,
		maxOutput: 8192,
		streaming: true,
		vision: false,
		reasoning: false,
		reasoningOutput: null,
		reasoningMaxTokens: false,
		rerank: false,
		tools: false,
		jsonOutput: false,
		jsonOutputSchema: false,
		webSearch: false,
		webSearchPrice: null,
		supportedVideoSizes: null,
		supportedVideoDurationsSeconds: null,
		supportsVideoAudio: null,
		supportsVideoWithoutAudio: null,
		perSecondPrice: null,
		perImagePrice: null,
		pricingTiers: null,
		discount: null,
		stability: "stable",
		supportedParameters: null,
		deprecatedAt: null,
		deactivatedAt: null,
		status: "active",
		...overrides,
	};
}

function makeProvider(id: string, streaming: boolean): ApiProvider {
	return {
		id,
		createdAt: "2026-01-01T00:00:00.000Z",
		name: id,
		description: null,
		streaming,
		cancellation: null,
		color: null,
		website: null,
		announcement: null,
		status: "active",
	};
}

function makeModel(
	providers: ApiModelProviderMapping[],
	id = "mock-model",
): ApiModel & {
	providerDetails: Array<{
		provider: ApiModelProviderMapping;
		providerInfo: ApiProvider;
	}>;
} {
	return {
		id,
		createdAt: "2026-01-01T00:00:00.000Z",
		releasedAt: null,
		name: "Mock Model",
		aliases: null,
		description: null,
		family: "mock",
		free: false,
		output: ["text"],
		stability: "stable",
		status: "active",
		premium: false,
		mappings: providers,
		providerDetails: providers.map((mapping) => ({
			provider: mapping,
			providerInfo: makeProvider(mapping.providerId, mapping.streaming),
		})),
	};
}

describe("use case per-row re-check in the flatten loop", () => {
	// Default row-filter options: no provider, capability, category, or use-case
	// filters active, so a single call tests the use-case dimension in isolation.
	function rowOptions(category?: string): ProviderRowFilterOptions {
		return {
			providerFilter: null,
			capabilities: {
				streaming: false,
				vision: false,
				tools: false,
				reasoning: false,
				reasoningBudget: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				webSearch: false,
				discounted: false,
			},
			category,
		};
	}

	// The production flatten loop (all-models.tsx) calls providerRowPassesFilters
	// for every mapping; this helper drives that exact function per row so a
	// regression in the shared row-filter decision fails these tests.
	function filterRows(
		model: ReturnType<typeof makeModel>,
		category?: string,
		options?: Partial<ProviderRowFilterOptions>,
	): ApiModelProviderMapping[] {
		const opts = { ...rowOptions(category), ...options };
		return model.providerDetails
			.filter(({ provider }) => providerRowPassesFilters(model, provider, opts))
			.map(({ provider }) => provider);
	}

	const cases: Array<{
		category: string;
		qualifying: Partial<ApiModelProviderMapping>;
		nonQualifying: Partial<ApiModelProviderMapping>;
	}> = [
		{
			category: "chat",
			qualifying: { streaming: true, cachedInputPrice: "0.2e-6" },
			nonQualifying: { streaming: true, cachedInputPrice: null },
		},
		{
			category: "reasoning",
			qualifying: { reasoning: true },
			nonQualifying: { reasoning: false },
		},
		{
			category: "creative",
			qualifying: { streaming: true },
			nonQualifying: { streaming: false },
		},
		{
			category: "multimodal",
			qualifying: { vision: true },
			nonQualifying: { vision: false },
		},
	];

	for (const { category, qualifying, nonQualifying } of cases) {
		const model = makeModel([
			makeMapping({ id: "qualifying", providerId: "alpha", ...qualifying }),
			makeMapping({
				id: "non-qualifying",
				providerId: "beta",
				...nonQualifying,
			}),
		]);

		test(`${category}: model qualifies at the model level via any mapping`, () => {
			expect(applyUseCaseFilter(category, model, model.mappings)).toBe(true);
		});

		test(`${category}: only the qualifying row survives the per-row re-check`, () => {
			const rows = filterRows(model, category);
			expect(rows.map((r) => r.id)).toEqual(["qualifying"]);
		});

		test(`${category}: the non-qualifying row fails the single-element check`, () => {
			const nonQualifyingProvider = model.providerDetails.find(
				(p) => p.provider.id === "non-qualifying",
			)!.provider;
			expect(applyUseCaseFilter(category, model, [nonQualifyingProvider])).toBe(
				false,
			);
		});
	}

	test("code: only a coding-capable mapping survives the per-row re-check", () => {
		const model = makeModel([
			makeMapping({
				id: "qualifying",
				providerId: "alpha",
				streaming: true,
				tools: true,
				cachedInputPrice: "0.2e-6",
				stability: "stable",
			}),
			makeMapping({
				id: "non-qualifying",
				providerId: "beta",
				streaming: true,
				tools: false,
				cachedInputPrice: null,
				stability: "stable",
			}),
		]);

		expect(applyUseCaseFilter("code", model, model.mappings)).toBe(true);
		expect(filterRows(model, "code").map((r) => r.id)).toEqual(["qualifying"]);
		const nonQualifyingProvider = model.providerDetails.find(
			(p) => p.provider.id === "non-qualifying",
		)!.provider;
		expect(applyUseCaseFilter("code", model, [nonQualifyingProvider])).toBe(
			false,
		);
	});

	test("creative: image-generation models are excluded regardless of streaming", () => {
		const model = makeModel(
			[
				makeMapping({
					id: "image-mapping",
					providerId: "alpha",
					streaming: true,
				}),
			],
			"image-model",
		);
		model.output = ["text", "image"];

		expect(applyUseCaseFilter("creative", model, model.mappings)).toBe(false);
		expect(filterRows(model, "creative")).toEqual([]);
	});

	test("image: model-level output check is constant across rows", () => {
		const imageModel = makeModel(
			[
				makeMapping({ id: "alpha", providerId: "alpha" }),
				makeMapping({ id: "beta", providerId: "beta" }),
			],
			"image-model",
		);
		imageModel.output = ["image"];

		expect(filterRows(imageModel, "image").map((r) => r.id)).toEqual([
			"alpha",
			"beta",
		]);

		const textModel = makeModel([
			makeMapping({ id: "alpha", providerId: "alpha" }),
		]);
		expect(filterRows(textModel, "image")).toEqual([]);
	});

	test("all: every row passes", () => {
		const model = makeModel([
			makeMapping({ id: "alpha", providerId: "alpha" }),
			makeMapping({ id: "beta", providerId: "beta" }),
		]);
		expect(filterRows(model, "all").map((r) => r.id)).toEqual([
			"alpha",
			"beta",
		]);
	});
});

describe("providerRowPassesFilters: full production row-filter path", () => {
	// Default row-filter options mirror the component's reset state.
	function baseOptions(): ProviderRowFilterOptions {
		return {
			providerFilter: null,
			capabilities: {
				streaming: false,
				vision: false,
				tools: false,
				reasoning: false,
				reasoningBudget: false,
				jsonOutput: false,
				jsonOutputSchema: false,
				webSearch: false,
				discounted: false,
			},
		};
	}

	test("capability filter: non-qualifying mapping is dropped per row", () => {
		const model = makeModel([
			makeMapping({ id: "streaming", providerId: "alpha", streaming: true }),
			makeMapping({ id: "no-streaming", providerId: "beta", streaming: false }),
		]);
		const options = baseOptions();
		options.capabilities.streaming = true;

		const rows = model.providerDetails
			.filter(({ provider }) =>
				providerRowPassesFilters(model, provider, options),
			)
			.map(({ provider }) => provider);
		expect(rows.map((r) => r.id)).toEqual(["streaming"]);
	});

	test("provider filter: only the selected provider's rows survive", () => {
		const model = makeModel([
			makeMapping({ id: "alpha-1", providerId: "alpha" }),
			makeMapping({ id: "beta-1", providerId: "beta" }),
		]);
		const options = baseOptions();
		options.providerFilter = "beta";

		const rows = model.providerDetails
			.filter(({ provider }) =>
				providerRowPassesFilters(model, provider, options),
			)
			.map(({ provider }) => provider);
		expect(rows.map((r) => r.id)).toEqual(["beta-1"]);
	});

	test("category filter: re-checked per row against the category predicate", () => {
		const model = makeModel([
			makeMapping({ id: "vision", providerId: "alpha", vision: true }),
			makeMapping({ id: "no-vision", providerId: "beta", vision: false }),
		]);
		model.output = ["text", "image"];
		const options = baseOptions();
		options.categoryFilter = "image-to-image";

		const rows = model.providerDetails
			.filter(({ provider }) =>
				providerRowPassesFilters(model, provider, options),
			)
			.map(({ provider }) => provider);
		expect(rows.map((r) => r.id)).toEqual(["vision"]);
	});

	test("unknown category value matches every row like the default", () => {
		const model = makeModel([
			makeMapping({ id: "alpha", providerId: "alpha" }),
			makeMapping({ id: "beta", providerId: "beta" }),
		]);
		const options = baseOptions();
		options.category = "not-a-real-category";

		const rows = model.providerDetails
			.filter(({ provider }) =>
				providerRowPassesFilters(model, provider, options),
			)
			.map(({ provider }) => provider);
		expect(rows.map((r) => r.id)).toEqual(["alpha", "beta"]);
	});
});
