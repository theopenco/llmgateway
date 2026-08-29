import { describe, expect, test } from "vitest";

import { applyCategoryFilter } from "./model-category-filters";
import {
	applyUseCaseFilter,
	getExcludedCapabilityKeys,
	getImpliedCapabilityKeys,
	providerRowPassesFilters,
	useCaseCategories,
} from "./use-case-filters";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "./api-types";
import type { ModelCategoryFilter } from "./model-category-filters";
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

// Pin the implication tables to the real predicates: each test breaks (or
// grants) exactly one capability on an otherwise fully-capable model and
// expects the category to reject it. Loosening a predicate without updating
// the table fails here, so a toggle is never wrongly left disabled.
describe("category → capability implication tables", () => {
	const capableMapping: Partial<ApiModelProviderMapping> = {
		streaming: true,
		tools: true,
		reasoning: true,
		vision: true,
		webSearch: true,
		cachedInputPrice: "0.2e-6",
		discount: "0.2",
	};
	const mappingBreakers: Record<string, Partial<ApiModelProviderMapping>> = {
		streaming: { streaming: false },
		tools: { tools: false },
		reasoning: { reasoning: false },
		vision: { vision: false },
		webSearch: { webSearch: false },
		discounted: { discount: null },
	};
	// Capability keys whose predicate is a model output modality rather than a
	// mapping flag; breaking them means removing that modality from `output`.
	const outputModalityByCapability: Record<string, string> = {
		imageGeneration: "image",
		videoGeneration: "video",
		embedding: "embedding",
	};

	function capableModel(output: string[]) {
		const model = makeModel([makeMapping(capableMapping)]);
		model.output = output;
		return model;
	}

	function brokenModel(output: string[], key: string) {
		const modality = outputModalityByCapability[key];
		if (modality) {
			return capableModel(output.filter((o) => o !== modality));
		}
		const breaker = mappingBreakers[key];
		if (!breaker) {
			throw new Error(`no capability breaker defined for key "${key}"`);
		}
		const model = makeModel([makeMapping({ ...capableMapping, ...breaker })]);
		model.output = output;
		return model;
	}

	describe("Use Case implied keys are enforced by applyUseCaseFilter", () => {
		function outputFor(category: string): string[] {
			return category === "image" ? ["image"] : ["text"];
		}

		for (const category of useCaseCategories) {
			for (const key of getImpliedCapabilityKeys(category)) {
				test(`${category} implies ${key}`, () => {
					const good = capableModel(outputFor(category));
					expect(applyUseCaseFilter(category, good, good.mappings)).toBe(true);
					const bad = brokenModel(outputFor(category), key);
					expect(applyUseCaseFilter(category, bad, bad.mappings)).toBe(false);
				});
			}
		}

		test("'all' and unknown categories imply nothing", () => {
			expect(getImpliedCapabilityKeys("all")).toEqual([]);
			expect(getImpliedCapabilityKeys(null)).toEqual([]);
			expect(getImpliedCapabilityKeys("not-a-real-category")).toEqual([]);
		});
	});

	describe("Use Case excluded keys can never match", () => {
		// Granting the excluded capability must make the category reject the
		// model, proving the combination is empty by construction.
		const granters: Record<
			string,
			(model: ReturnType<typeof capableModel>) => void
		> = {
			free: (model) => {
				model.free = true;
			},
			imageGeneration: (model) => {
				model.output = [...(model.output ?? []), "image"];
			},
		};

		for (const category of useCaseCategories) {
			for (const key of getExcludedCapabilityKeys(category)) {
				test(`${category} excludes ${key}`, () => {
					const granter = granters[key];
					if (!granter) {
						throw new Error(`no capability granter defined for key "${key}"`);
					}
					const model = capableModel(["text"]);
					expect(applyUseCaseFilter(category, model, model.mappings)).toBe(
						true,
					);
					granter(model);
					expect(applyUseCaseFilter(category, model, model.mappings)).toBe(
						false,
					);
				});
			}
		}

		test("categories without exclusions return an empty list", () => {
			expect(getExcludedCapabilityKeys("chat")).toEqual([]);
			expect(getExcludedCapabilityKeys("all")).toEqual([]);
			expect(getExcludedCapabilityKeys(null)).toEqual([]);
		});
	});

	describe("category-page implied keys are enforced by applyCategoryFilter", () => {
		const filtersWithImplications: ModelCategoryFilter[] = [
			"text-to-image",
			"image-to-image",
			"video",
			"embedding",
			"web-search",
			"vision",
			"reasoning",
			"tools",
			"discounted",
		];

		function outputFor(categoryFilter: ModelCategoryFilter): string[] {
			switch (categoryFilter) {
				case "text-to-image":
				case "image-to-image":
					return ["image"];
				case "video":
					return ["video"];
				case "embedding":
					return ["embedding"];
				default:
					return ["text"];
			}
		}

		for (const categoryFilter of filtersWithImplications) {
			const implied = getImpliedCapabilityKeys(null, categoryFilter);
			test(`${categoryFilter} implies ${implied.join(", ")}`, () => {
				expect(implied.length).toBeGreaterThan(0);
				for (const key of implied) {
					const good = capableModel(outputFor(categoryFilter));
					expect(applyCategoryFilter(categoryFilter, good, good.mappings)).toBe(
						true,
					);
					const bad = brokenModel(outputFor(categoryFilter), key);
					expect(applyCategoryFilter(categoryFilter, bad, bad.mappings)).toBe(
						false,
					);
				}
			});
		}

		test("curated and price-based category pages imply nothing", () => {
			expect(getImpliedCapabilityKeys(null, "coding")).toEqual([]);
			expect(getImpliedCapabilityKeys(null, "cheapest")).toEqual([]);
			expect(getImpliedCapabilityKeys(null, "long-context")).toEqual([]);
			expect(getImpliedCapabilityKeys(null, "text")).toEqual([]);
		});
	});
});
