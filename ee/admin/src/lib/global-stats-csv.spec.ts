import { describe, expect, test } from "vitest";

import {
	buildGlobalStatsBreakdownCsv,
	buildGlobalStatsReportCsv,
	buildGlobalStatsTimeseriesBreakdownCsv,
	buildGlobalStatsTimeseriesCsv,
	globalStatsExportFilename,
} from "./global-stats-csv";

const metrics = {
	requestCount: 10,
	errorCount: 1,
	cacheCount: 2,
	inputTokens: 100,
	cachedTokens: 20,
	outputTokens: 50,
	totalTokens: 150,
	cost: 0.0000005,
	inputCost: 0.0000003,
	cachedInputCost: 0,
	outputCost: 0.0000002,
};

describe("buildGlobalStatsTimeseriesCsv", () => {
	test("writes every metric per day without exponent notation", () => {
		const csv = buildGlobalStatsTimeseriesCsv([
			{ date: "2026-09-01", ...metrics },
		]);
		expect(csv.split("\n")).toEqual([
			"date,requestCount,errorCount,cacheCount,inputTokens,cachedTokens,outputTokens,totalTokens,cost,inputCost,cachedInputCost,outputCost",
			"2026-09-01,10,1,2,100,20,50,150,0.0000005,0.0000003,0,0.0000002",
		]);
	});

	test("honours comma-decimal locales", () => {
		const csv = buildGlobalStatsTimeseriesCsv(
			[{ date: "2026-09-01", ...metrics }],
			{ delimiter: ";", decimalSeparator: "," },
		);
		expect(csv.split("\n")[1]).toBe(
			"2026-09-01;10;1;2;100;20;50;150;0,0000005;0,0000003;0;0,0000002",
		);
	});
});

describe("buildGlobalStatsTimeseriesBreakdownCsv", () => {
	test("pivots every dimension into a column for the selected metric", () => {
		const csv = buildGlobalStatsTimeseriesBreakdownCsv({
			rankedBreakdown: [
				{ key: "openai/gpt-5.6", label: "openai/gpt-5.6" },
				{ key: "anthropic/claude", label: "anthropic/claude" },
			],
			timeseries: [{ date: "2026-09-01" }, { date: "2026-09-02" }],
			timeseriesBreakdown: [
				{
					date: "2026-09-01",
					key: "openai/gpt-5.6",
					requestCount: 3,
					cost: 1.5,
					totalTokens: 30,
				},
				{
					date: "2026-09-02",
					key: "anthropic/claude",
					requestCount: 4,
					cost: 2.25,
					totalTokens: 40,
				},
				{
					date: "2026-09-03",
					key: "anthropic/claude",
					requestCount: 9,
					cost: 9,
					totalTokens: 9,
				},
			],
			metric: "cost",
		});
		expect(csv.split("\n")).toEqual([
			"date,openai/gpt-5.6,anthropic/claude",
			"2026-09-01,1.5,0",
			"2026-09-02,0,2.25",
		]);
	});

	test("disambiguates colliding labels with the key", () => {
		const csv = buildGlobalStatsTimeseriesBreakdownCsv({
			rankedBreakdown: [
				{ key: "a", label: "Same" },
				{ key: "b", label: "Same" },
			],
			timeseries: [],
			timeseriesBreakdown: [],
			metric: "requestCount",
		});
		expect(csv).toBe("date,Same (a),Same (b)");
	});
});

describe("buildGlobalStatsBreakdownCsv", () => {
	test("includes all metrics and the selected metric's share", () => {
		const csv = buildGlobalStatsBreakdownCsv({
			dimension: "model",
			breakdown: [
				{ key: "a", label: "A", ...metrics, requestCount: 30 },
				{ key: "b", label: "B", ...metrics, requestCount: 10 },
			],
			metric: "requestCount",
		});
		const lines = csv.split("\n");
		expect(lines[0]).toBe(
			"model,label,requestCount,errorCount,cacheCount,inputTokens,cachedTokens,outputTokens,totalTokens,cost,inputCost,cachedInputCost,outputCost,requestCountSharePercent",
		);
		expect(lines[1].endsWith(",75")).toBe(true);
		expect(lines[2].endsWith(",25")).toBe(true);
	});

	test("escapes labels that contain the delimiter", () => {
		const csv = buildGlobalStatsBreakdownCsv({
			dimension: "source",
			breakdown: [{ key: "a,b", label: "=cmd", ...metrics }],
			metric: "cost",
		});
		expect(csv.split("\n")[1].startsWith('"a,b",\'=cmd,')).toBe(true);
	});
});

describe("buildGlobalStatsReportCsv", () => {
	test("emits titled, blank-line separated sections honouring the filters", () => {
		const csv = buildGlobalStatsReportCsv({
			scope: {
				start: "2026-09-01",
				end: "2026-09-02",
				allTime: false,
				traffic: "Credits",
				organization: "All orgs",
				groupBy: "By model",
				modelView: "Providers",
				metric: "cost",
			},
			generatedAt: new Date("2026-09-07T00:00:00Z"),
			totals: metrics,
			composition: {
				byMode: null,
				byKind: [
					{
						key: "default",
						label: "PAYG",
						requestCount: 10,
						cost: 1,
						totalTokens: 150,
					},
				],
			},
			timeseries: [{ date: "2026-09-01", ...metrics }],
			timeseriesBreakdown: [
				{
					date: "2026-09-01",
					key: "openai",
					requestCount: 10,
					cost: 1,
					totalTokens: 150,
				},
			],
			breakdown: [{ key: "openai", label: "openai", ...metrics }],
			dimension: "provider",
		});
		const sections = csv.split("\n\n");
		expect(sections.map((section) => section.split("\n")[0])).toEqual([
			"Global stats report",
			"Totals",
			"Composition by organization kind",
			"Daily timeseries",
			"Daily cost by provider",
			"Breakdown by provider",
		]);
		expect(sections[0]).toContain("modelView,Providers");
		expect(sections[0]).toContain("traffic,Credits");
		expect(sections[0]).toContain("generated,2026-09-07T00:00:00.000Z");
		expect(csv).not.toContain("Composition by billing mode");
		expect(sections[4].split("\n")).toEqual([
			"Daily cost by provider",
			"date,openai",
			"2026-09-01,1",
		]);
	});
});

describe("globalStatsExportFilename", () => {
	test("encodes the range", () => {
		expect(
			globalStatsExportFilename("timeseries", {
				start: "2026-09-01",
				end: "2026-09-07",
				allTime: false,
			}),
		).toBe("global-stats-timeseries-2026-09-01_2026-09-07.csv");
		expect(
			globalStatsExportFilename("report", {
				start: "2026-01-01",
				end: "2026-09-07",
				allTime: true,
			}),
		).toBe("global-stats-report-all-time.csv");
	});
});
