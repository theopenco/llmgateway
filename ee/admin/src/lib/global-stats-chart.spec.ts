import { describe, expect, test } from "vitest";

import { buildGlobalStatsStackedChart } from "./global-stats-chart";

const metricValues = {
	requestCount: 1,
	cost: 1,
	totalTokens: 1,
};

describe("buildGlobalStatsStackedChart", () => {
	test("maps punctuation-heavy dimension ids to distinct safe keys", () => {
		const breakdown = [
			{ key: "openai/gpt-5.6", label: "Mapping", ...metricValues },
			{ key: "openai.gpt-5/6", label: "Collision candidate", ...metricValues },
			{ key: "model:preview", label: "Preview", ...metricValues },
		];
		const chart = buildGlobalStatsStackedChart({
			rankedBreakdown: breakdown,
			timeseries: [{ date: "2026-09-01" }],
			timeseriesBreakdown: breakdown.map((item, index) => ({
				date: "2026-09-01",
				key: item.key,
				requestCount: index + 1,
				cost: index + 1,
				totalTokens: index + 1,
			})),
			metric: "cost",
			limit: 8,
		});

		expect(chart.series).toEqual([
			{ chartKey: "series_0", label: "Mapping", sourceKey: breakdown[0].key },
			{
				chartKey: "series_1",
				label: "Collision candidate",
				sourceKey: breakdown[1].key,
			},
			{ chartKey: "series_2", label: "Preview", sourceKey: breakdown[2].key },
		]);
		expect(chart.data[0]).toMatchObject({
			series_0: 1,
			series_1: 2,
			series_2: 3,
		});
		expect(
			chart.series.every((entry) => /^[a-zA-Z0-9_-]+$/.test(entry.chartKey)),
		).toBe(true);
	});

	test("zero-fills dates and folds series beyond the limit into Other", () => {
		const breakdown = Array.from({ length: 4 }, (_, index) => ({
			key: `model/${index}`,
			label: `Model ${index}`,
			requestCount: 4 - index,
			cost: 4 - index,
			totalTokens: 4 - index,
		}));
		const chart = buildGlobalStatsStackedChart({
			rankedBreakdown: breakdown,
			timeseries: [{ date: "2026-09-01" }, { date: "2026-09-02" }],
			timeseriesBreakdown: [
				{ date: "2026-09-01", key: "model/0", ...metricValues },
				{ date: "2026-09-01", key: "model/2", ...metricValues },
				{
					date: "2026-09-01",
					key: "model/3",
					requestCount: 2,
					cost: 2,
					totalTokens: 2,
				},
			],
			metric: "requestCount",
			limit: 2,
		});

		expect(chart.restCount).toBe(2);
		expect(chart.series.at(-1)).toEqual({
			chartKey: "series_other",
			label: "Other (2)",
			sourceKey: null,
		});
		expect(chart.data).toEqual([
			{
				date: "2026-09-01",
				series_0: 1,
				series_1: 0,
				series_other: 3,
			},
			{
				date: "2026-09-02",
				series_0: 0,
				series_1: 0,
				series_other: 0,
			},
		]);
	});
});
