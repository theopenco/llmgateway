import { describe, expect, test } from "vitest";

import { models } from "@llmgateway/models";

import {
	mappingFamily,
	summarizeGlobalStatsByFamily,
	UNKNOWN_FAMILY,
} from "./global-stats-family";

const claude = models.find((model) => model.family === "anthropic")!.id;
const gpt = models.find((model) => model.family === "openai")!.id;

const metrics = {
	requestCount: 0,
	errorCount: 0,
	cacheCount: 0,
	inputTokens: 0,
	cachedTokens: 0,
	cacheWriteTokens: 0,
	outputTokens: 0,
	reasoningTokens: 0,
	totalTokens: 0,
	cost: 0,
	inputCost: 0,
	cachedInputCost: 0,
	cacheWriteInputCost: 0,
	outputCost: 0,
	requestCost: 0,
	imageInputCost: 0,
	imageOutputCost: 0,
	audioInputCost: 0,
	audioOutputCost: 0,
	videoOutputCost: 0,
};

function row(key: string, requestCount: number, cost: number) {
	return { key, label: key, ...metrics, requestCount, cost };
}

const breakdown = [
	row(`anthropic/${claude}`, 10, 1),
	row(`aws-bedrock/${claude}`, 5, 0.5),
	row(`openai/${gpt}`, 2, 0.25),
	row("openai/retired-model-9000", 1, 0.125),
];

const timeseries = [
	{ date: "2026-09-01", ...metrics, requestCount: 18, cost: 1.875 },
	{ date: "2026-09-02", ...metrics },
];

const timeseriesBreakdown = [
	{
		date: "2026-09-01",
		key: `anthropic/${claude}`,
		label: `anthropic/${claude}`,
		requestCount: 10,
		cost: 1,
		totalTokens: 0,
	},
	{
		date: "2026-09-01",
		key: `aws-bedrock/${claude}`,
		label: `aws-bedrock/${claude}`,
		requestCount: 5,
		cost: 0.5,
		totalTokens: 0,
	},
	{
		date: "2026-09-01",
		key: `openai/${gpt}`,
		label: `openai/${gpt}`,
		requestCount: 2,
		cost: 0.25,
		totalTokens: 0,
	},
];

const totals = { ...metrics, requestCount: 18, cost: 1.875 };

describe("mappingFamily", () => {
	test("reads the model, not the provider that served it", () => {
		expect(mappingFamily(`anthropic/${claude}`)).toBe("anthropic");
		expect(mappingFamily(`aws-bedrock/${claude}`)).toBe("anthropic");
		expect(mappingFamily(`aws-bedrock/${claude}:thinking`)).toBe("anthropic");
		expect(mappingFamily(`openai/${gpt}`)).toBe("openai");
	});

	test("buckets models the catalogue no longer knows", () => {
		expect(mappingFamily("openai/retired-model-9000")).toBe(UNKNOWN_FAMILY);
	});
});

describe("summarizeGlobalStatsByFamily", () => {
	test("sums one family across every provider that served it", () => {
		const summary = summarizeGlobalStatsByFamily({
			breakdown,
			timeseries,
			timeseriesBreakdown,
			totals,
			family: null,
			view: "family",
		});
		expect(
			summary.breakdown.map((item) => [item.key, item.requestCount, item.cost]),
		).toEqual([
			["anthropic", 15, 1.5],
			["openai", 2, 0.25],
			[UNKNOWN_FAMILY, 1, 0.125],
		]);
		expect(summary.breakdown[2].label).toBe("Unknown family");
		// Unfiltered, the response already covers the rows on screen.
		expect(summary.totals).toBe(totals);
		expect(summary.timeseriesPartial).toBe(false);
	});

	test("narrows totals and buckets to the selected family", () => {
		const summary = summarizeGlobalStatsByFamily({
			breakdown,
			timeseries,
			timeseriesBreakdown,
			totals,
			family: "anthropic",
			view: "mapping",
		});
		expect(summary.breakdown.map((item) => item.key)).toEqual([
			`anthropic/${claude}`,
			`aws-bedrock/${claude}`,
		]);
		expect(summary.totals.requestCount).toBe(15);
		expect(summary.totals.cost).toBe(1.5);
		expect(summary.timeseries).toEqual([
			{ ...metrics, date: "2026-09-01", requestCount: 15, cost: 1.5 },
			{ ...metrics, date: "2026-09-02" },
		]);
		expect(summary.timeseriesPartial).toBe(true);
	});

	test("re-keys a filtered family into its serving providers", () => {
		const summary = summarizeGlobalStatsByFamily({
			breakdown,
			timeseries,
			timeseriesBreakdown,
			totals,
			family: "anthropic",
			view: "provider",
		});
		expect(
			summary.breakdown.map((item) => [item.key, item.requestCount]),
		).toEqual([
			["anthropic", 10],
			["aws-bedrock", 5],
		]);
		expect(
			summary.timeseriesBreakdown.map((point) => [point.key, point.cost]),
		).toEqual([
			["anthropic", 1],
			["aws-bedrock", 0.5],
		]);
	});

	test("collapses mappings to canonical model ids", () => {
		const summary = summarizeGlobalStatsByFamily({
			breakdown,
			timeseries,
			timeseriesBreakdown,
			totals,
			family: "anthropic",
			view: "canonical",
		});
		expect(
			summary.breakdown.map((item) => [item.key, item.requestCount]),
		).toEqual([[claude, 15]]);
	});
});
