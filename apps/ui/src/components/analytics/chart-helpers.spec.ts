import { describe, expect, test } from "vitest";

import {
	aggregateCostByModel,
	buildDimensionTimeseries,
	buildModelTimeseries,
	OTHER_KEY,
	OTHER_LABEL,
	STORAGE_KEY,
	STORAGE_LABEL,
	toDimensionRows,
	UNATTRIBUTED_KEY,
	aggregateByDimension,
} from "./chart-helpers.js";

const modeSplit = {
	creditsRequestCount: 0,
	apiKeysRequestCount: 0,
	creditsCost: 0,
	apiKeysCost: 0,
};

function day(overrides: {
	cost: number;
	requestCount: number;
	totalTokens: number;
	userBreakdown?: {
		id: string;
		name: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
	}[];
	apiKeyBreakdown?: {
		id: string;
		description: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
	}[];
	modelBreakdown?: {
		id: string;
		provider: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
	}[];
	dataStorageCost?: number;
}) {
	return {
		date: "2026-08-10",
		cost: overrides.cost,
		dataStorageCost: overrides.dataStorageCost ?? 0,
		requestCount: overrides.requestCount,
		totalTokens: overrides.totalTokens,
		modelBreakdown: (overrides.modelBreakdown ?? []).map((m) => ({
			...m,
			inputTokens: 0,
			outputTokens: 0,
			...modeSplit,
		})),
		apiKeyBreakdown: (overrides.apiKeyBreakdown ?? []).map((k) => ({
			...k,
			...modeSplit,
		})),
		userBreakdown: (overrides.userBreakdown ?? []).map((u) => ({
			...u,
			...modeSplit,
		})),
	};
}

describe("toDimensionRows", () => {
	test("maps the model breakdown, prefixing the provider", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 3,
					requestCount: 2,
					totalTokens: 100,
					modelBreakdown: [
						{
							id: "gpt-5.6",
							provider: "openai",
							cost: 3,
							requestCount: 2,
							totalTokens: 100,
						},
					],
				}),
			],
			"model",
		);

		expect(rows[0].breakdown).toHaveLength(1);
		expect(rows[0].breakdown[0].key).toBe("openai/gpt-5.6");
		expect(rows[0].breakdown[0].label).toBe("openai/gpt-5.6");
		expect(rows[0].breakdown[0].cost).toBe(3);
	});

	test("maps the api key breakdown using the key description as label", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 5,
					requestCount: 1,
					totalTokens: 10,
					apiKeyBreakdown: [
						{
							id: "key_1",
							description: "CI key",
							cost: 5,
							requestCount: 1,
							totalTokens: 10,
						},
					],
				}),
			],
			"apiKey",
		);

		expect(rows[0].breakdown[0]).toMatchObject({
			key: "key_1",
			label: "CI key",
			cost: 5,
		});
	});

	test("maps the user breakdown using the member name as label", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 8,
					requestCount: 4,
					totalTokens: 40,
					userBreakdown: [
						{
							id: "user_1",
							name: "Ada",
							cost: 5,
							requestCount: 3,
							totalTokens: 30,
						},
						{
							id: "user_2",
							name: "Grace",
							cost: 3,
							requestCount: 1,
							totalTokens: 10,
						},
					],
				}),
			],
			"user",
		);

		expect(rows[0].breakdown.map((e) => e.label)).toEqual(["Ada", "Grace"]);
		// Fully attributed: no residual series.
		expect(rows[0].breakdown.some((e) => e.key === UNATTRIBUTED_KEY)).toBe(
			false,
		);
	});

	// Platform-key traffic never reaches the per-key rollups, so the per-user rows
	// sum to less than the project total. Surface the gap rather than under-report.
	test("adds an Unattributed entry for the residual", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 10,
					requestCount: 10,
					totalTokens: 100,
					userBreakdown: [
						{
							id: "user_1",
							name: "Ada",
							cost: 4,
							requestCount: 6,
							totalTokens: 60,
						},
					],
				}),
			],
			"user",
		);

		const residual = rows[0].breakdown.find((e) => e.key === UNATTRIBUTED_KEY);
		expect(residual).toBeDefined();
		expect(residual!.cost).toBe(6);
		expect(residual!.requestCount).toBe(4);
		expect(residual!.totalTokens).toBe(40);
	});

	// Free-model platform traffic costs nothing but still moves requests and
	// tokens, so gating the residual on cost alone would hide it from those tabs.
	test("adds an Unattributed entry for zero-cost platform traffic", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 4,
					requestCount: 10,
					totalTokens: 100,
					userBreakdown: [
						{
							id: "user_1",
							name: "Ada",
							cost: 4,
							requestCount: 6,
							totalTokens: 60,
						},
					],
				}),
			],
			"user",
		);

		const residual = rows[0].breakdown.find((e) => e.key === UNATTRIBUTED_KEY);
		expect(residual).toBeDefined();
		expect(residual!.cost).toBe(0);
		expect(residual!.requestCount).toBe(4);
		expect(residual!.totalTokens).toBe(40);
	});

	test("per-user costs sum back to the project total", () => {
		const activity = [
			day({
				cost: 10,
				requestCount: 10,
				totalTokens: 100,
				userBreakdown: [
					{
						id: "user_1",
						name: "Ada",
						cost: 4,
						requestCount: 6,
						totalTokens: 60,
					},
				],
			}),
		];

		const { totalCost } = aggregateByDimension(
			toDimensionRows(activity, "user"),
		);
		expect(totalCost).toBe(activity[0].cost);
	});

	test("ignores sub-cent rounding noise between the two rollups", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 1,
					requestCount: 1,
					totalTokens: 1,
					userBreakdown: [
						{
							id: "user_1",
							name: "Ada",
							cost: 1 - 1e-12,
							requestCount: 1,
							totalTokens: 1,
						},
					],
				}),
			],
			"user",
		);

		expect(rows[0].breakdown).toHaveLength(1);
	});

	test("never emits a negative residual when the per-key rollup runs ahead", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 4,
					requestCount: 2,
					totalTokens: 20,
					userBreakdown: [
						{
							id: "user_1",
							name: "Ada",
							cost: 5,
							requestCount: 3,
							totalTokens: 30,
						},
					],
				}),
			],
			"user",
		);

		expect(rows[0].breakdown).toHaveLength(1);
	});

	test("adds an Unattributed entry for platform keys in the API key view", () => {
		const rows = toDimensionRows(
			[
				day({
					cost: 8,
					requestCount: 4,
					totalTokens: 40,
					apiKeyBreakdown: [
						{
							id: "key_1",
							description: "CI key",
							cost: 5,
							requestCount: 3,
							totalTokens: 30,
						},
					],
				}),
			],
			"apiKey",
		);

		expect(
			rows[0].breakdown.find((e) => e.key === UNATTRIBUTED_KEY),
		).toMatchObject({ cost: 3, requestCount: 1, totalTokens: 10 });
	});

	test("adds storage so every grouping adds up to the total spend", () => {
		for (const groupBy of ["model", "apiKey", "user"] as const) {
			const rows = toDimensionRows(
				[
					day({
						cost: 3,
						requestCount: 2,
						totalTokens: 20,
						dataStorageCost: 0.5,
						modelBreakdown: [
							{
								id: "gpt-5.6",
								provider: "openai",
								cost: 3,
								requestCount: 2,
								totalTokens: 20,
							},
						],
					}),
				],
				groupBy,
			);
			const storage = rows[0].breakdown.find((e) => e.key === STORAGE_KEY);
			expect(storage).toMatchObject({
				label: STORAGE_LABEL,
				cost: 0.5,
				requestCount: 0,
			});
			expect(
				rows[0].breakdown.reduce((total, e) => total + e.cost, 0),
			).toBeCloseTo(3.5);
		}
	});
});

function modelDay(costs: number[], dataStorageCost = 0) {
	return {
		date: "2026-08-10",
		dataStorageCost,
		modelBreakdown: costs.map((cost, index) => ({
			id: `model-${index}`,
			provider: "openai",
			cost,
			requestCount: 1,
			totalTokens: 10,
			inputTokens: 0,
			outputTokens: 0,
			...modeSplit,
		})),
	};
}

describe("model charts", () => {
	test("rank storage alongside models and include it in the total", () => {
		const result = aggregateCostByModel([modelDay([1, 2], 5)], "mapping");
		expect(result.totalCost).toBe(8);
		expect(result.models[0]).toMatchObject({
			model: STORAGE_LABEL,
			cost: 5,
			requestCount: 0,
		});
	});

	test("collapse models past the top N into Other", () => {
		const series = buildModelTimeseries(
			[modelDay([5, 4, 3, 2, 1], 0.5)],
			"mapping",
			2,
		);
		expect(series.models).toEqual([
			"openai/model-0",
			"openai/model-1",
			OTHER_LABEL,
		]);
		const entries = series.data[0].entries;
		expect(entries[OTHER_LABEL]).toMatchObject({ cost: 6.5, requestCount: 3 });
		expect(
			Object.values(entries).reduce((total, e) => total + e.cost, 0),
		).toBeCloseTo(15.5);
	});
});

describe("buildDimensionTimeseries", () => {
	test("collapses entries past the top N into Other", () => {
		const entry = (key: string, cost: number) => ({
			key,
			label: key,
			cost,
			requestCount: 1,
			totalTokens: 1,
			...modeSplit,
		});
		const result = buildDimensionTimeseries(
			[
				{
					date: "2026-08-10",
					breakdown: [entry("a", 3), entry("b", 2), entry("c", 1)],
				},
			],
			"cost",
			1,
		);
		expect(result.series).toEqual([
			{ key: "a", label: "a" },
			{ key: OTHER_KEY, label: OTHER_LABEL },
		]);
		expect(result.data[0].entries[OTHER_KEY]).toMatchObject({
			cost: 3,
			requestCount: 2,
		});
	});
});
