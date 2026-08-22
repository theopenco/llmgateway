import { describe, expect, test } from "vitest";

import { discountFraction } from "@/lib/discount";

import { matchesCapability, type CapabilityFilter } from "./capability-filters";
import {
	applyCategoryFilter,
	type ModelCategoryFilter,
} from "./model-category-filters";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "./api-types";

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

describe("category per-row re-check in the flatten loop", () => {
	// Faithful replica of the flatten loop's category re-check
	// (all-models.tsx:1360-1368): a single-element array tests just this row.
	function flattenWithCategory(
		model: ReturnType<typeof makeModel>,
		categoryFilter: ModelCategoryFilter,
	): ApiModelProviderMapping[] {
		const rows: ApiModelProviderMapping[] = [];
		for (const { provider } of model.providerDetails) {
			if (!applyCategoryFilter(categoryFilter, model, [provider])) {
				continue;
			}
			rows.push(provider);
		}
		return rows;
	}

	const cases: Array<{
		category: ModelCategoryFilter;
		qualifying: Partial<ApiModelProviderMapping>;
		nonQualifying: Partial<ApiModelProviderMapping>;
	}> = [
		{
			category: "discounted",
			qualifying: { discount: "0.5" },
			nonQualifying: { discount: null },
		},
		{
			category: "vision",
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
			expect(applyCategoryFilter(category, model, model.mappings)).toBe(true);
		});

		test(`${category}: only the qualifying row survives the per-row re-check`, () => {
			const rows = flattenWithCategory(model, category);
			expect(rows.map((r) => r.id)).toEqual(["qualifying"]);
		});

		test(`${category}: the non-qualifying row fails the single-element check`, () => {
			const nonQualifyingProvider = model.providerDetails.find(
				(p) => p.provider.id === "non-qualifying",
			)!.provider;
			expect(
				applyCategoryFilter(category, model, [nonQualifyingProvider]),
			).toBe(false);
		});
	}
});

describe("discount sort ordering", () => {
	// Faithful replica of the grid comparator (all-models.tsx:1274-1285):
	// a model sorts by its highest discount across all mappings.
	function sortModelsByDiscount(
		models: Array<ReturnType<typeof makeModel>>,
		direction: "asc" | "desc",
	): Array<ReturnType<typeof makeModel>> {
		return [...models].sort((a, b) => {
			const aDiscounts = a.providerDetails.map((m) =>
				discountFraction(m.provider.discount),
			);
			const bDiscounts = b.providerDetails.map((m) =>
				discountFraction(m.provider.discount),
			);
			const aValue = aDiscounts.length > 0 ? Math.max(...aDiscounts) : 0;
			const bValue = bDiscounts.length > 0 ? Math.max(...bDiscounts) : 0;
			if (aValue < bValue) {
				return direction === "asc" ? -1 : 1;
			}
			if (aValue > bValue) {
				return direction === "asc" ? 1 : -1;
			}
			return 0;
		});
	}

	// Faithful replica of the table comparator (all-models.tsx:1465-1468):
	// a row sorts by its own discount.
	function sortRowsByDiscount(
		rows: Array<{ provider: ApiModelProviderMapping }>,
		direction: "asc" | "desc",
	): Array<{ provider: ApiModelProviderMapping }> {
		return [...rows].sort((a, b) => {
			const aValue = discountFraction(a.provider.discount);
			const bValue = discountFraction(b.provider.discount);
			if (aValue < bValue) {
				return direction === "asc" ? -1 : 1;
			}
			if (aValue > bValue) {
				return direction === "asc" ? 1 : -1;
			}
			return 0;
		});
	}

	const modelA = makeModel(
		[makeMapping({ id: "a", providerId: "alpha", discount: "0.5" })],
		"model-a",
	);
	const modelB = makeModel(
		[makeMapping({ id: "b", providerId: "beta", discount: "0.2" })],
		"model-b",
	);
	const modelC = makeModel(
		[makeMapping({ id: "c", providerId: "gamma", discount: null })],
		"model-c",
	);
	// Two mappings with different discounts — the grid sorts by the max.
	const modelD = makeModel(
		[
			makeMapping({ id: "d1", providerId: "delta", discount: "0.1" }),
			makeMapping({ id: "d2", providerId: "epsilon", discount: "0.4" }),
		],
		"model-d",
	);

	test("grid: desc orders models by highest discount, null last", () => {
		const sorted = sortModelsByDiscount(
			[modelC, modelB, modelA, modelD],
			"desc",
		);
		expect(sorted.map((m) => m.id)).toEqual([
			"model-a",
			"model-d",
			"model-b",
			"model-c",
		]);
	});

	test("grid: asc orders models by highest discount, null first", () => {
		const sorted = sortModelsByDiscount(
			[modelA, modelD, modelB, modelC],
			"asc",
		);
		expect(sorted.map((m) => m.id)).toEqual([
			"model-c",
			"model-b",
			"model-d",
			"model-a",
		]);
	});

	test("grid: a model with mixed mappings sorts by its max discount", () => {
		const discounts = modelD.providerDetails.map((m) =>
			discountFraction(m.provider.discount),
		);
		expect(Math.max(...discounts)).toBe(0.4);
	});

	test("table: desc orders rows by their own discount, null last", () => {
		const rows = [
			...modelA.providerDetails,
			...modelB.providerDetails,
			...modelC.providerDetails,
			...modelD.providerDetails,
		].map((p) => ({ provider: p.provider }));
		const sorted = sortRowsByDiscount(rows, "desc");
		expect(sorted.map((r) => r.provider.id)).toEqual([
			"a",
			"d2",
			"b",
			"d1",
			"c",
		]);
	});

	test("table: asc orders rows by their own discount, null first", () => {
		const rows = [
			...modelA.providerDetails,
			...modelB.providerDetails,
			...modelC.providerDetails,
			...modelD.providerDetails,
		].map((p) => ({ provider: p.provider }));
		const sorted = sortRowsByDiscount(rows, "asc");
		expect(sorted.map((r) => r.provider.id)).toEqual([
			"c",
			"d1",
			"b",
			"d2",
			"a",
		]);
	});
});

// Faithful replica of the flatten loop in all-models.tsx (1299-1337) after
// the row-leak fix: it expands every mapping of a model that passed the
// model-level filter, but skips any mapping that fails an active capability
// filter — mirroring the per-row re-check the loop now performs.
function flattenCurrent(
	model: ReturnType<typeof makeModel>,
	activeCapabilities: CapabilityFilter[],
): ApiModelProviderMapping[] {
	const rows: ApiModelProviderMapping[] = [];
	for (const { provider } of model.providerDetails) {
		if (
			activeCapabilities.some(
				(capability) => !matchesCapability(capability, provider),
			)
		) {
			continue;
		}
		rows.push(provider);
	}
	return rows;
}

describe("row-leak: model-level filter vs table flatten", () => {
	const cases: Array<{
		capability: CapabilityFilter;
		qualifying: Partial<ApiModelProviderMapping>;
		nonQualifying: Partial<ApiModelProviderMapping>;
	}> = [
		{
			capability: "streaming",
			qualifying: { streaming: true },
			nonQualifying: { streaming: false },
		},
		{
			capability: "vision",
			qualifying: { vision: true },
			nonQualifying: { vision: false },
		},
		{
			capability: "discounted",
			qualifying: { discount: "0.5" },
			nonQualifying: { discount: null },
		},
		{
			capability: "tools",
			qualifying: { tools: true },
			nonQualifying: { tools: false },
		},
		{
			capability: "reasoning",
			qualifying: { reasoning: true },
			nonQualifying: { reasoning: false },
		},
		{
			capability: "reasoningMaxTokens",
			qualifying: { reasoningMaxTokens: true },
			nonQualifying: { reasoningMaxTokens: false },
		},
		{
			capability: "jsonOutput",
			qualifying: { jsonOutput: true },
			nonQualifying: { jsonOutput: false },
		},
		{
			capability: "jsonOutputSchema",
			qualifying: { jsonOutputSchema: true },
			nonQualifying: { jsonOutputSchema: false },
		},
		{
			capability: "webSearch",
			qualifying: { webSearch: true },
			nonQualifying: { webSearch: false },
		},
	];

	for (const { capability, qualifying, nonQualifying } of cases) {
		const model = makeModel([
			makeMapping({ id: "qualifying", providerId: "alpha", ...qualifying }),
			makeMapping({
				id: "non-qualifying",
				providerId: "beta",
				...nonQualifying,
			}),
		]);

		test(`${capability}: model qualifies via the model-level some() check`, () => {
			expect(
				model.providerDetails.some((p) =>
					matchesCapability(capability, p.provider),
				),
			).toBe(true);
		});

		test(`${capability}: matchesCapability rejects the non-qualifying mapping`, () => {
			const nonQualifyingProvider = model.providerDetails.find(
				(p) => p.provider.id === "non-qualifying",
			)!.provider;
			expect(matchesCapability(capability, nonQualifyingProvider)).toBe(false);
		});

		test(`${capability}: every row in the filtered table satisfies the capability`, () => {
			const rows = flattenCurrent(model, [capability]);
			expect(rows.length).toBe(1);
			for (const provider of rows) {
				expect(matchesCapability(capability, provider)).toBe(true);
			}
		});
	}
});
