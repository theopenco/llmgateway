import { describe, expect, test } from "vitest";

import {
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
}) {
	return {
		date: "2026-08-10",
		cost: overrides.cost,
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
});
