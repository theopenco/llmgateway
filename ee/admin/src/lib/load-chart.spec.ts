import { describe, expect, it } from "vitest";

import { buildLoadChart } from "./load-chart";

const point = (
	timestamp: string,
	rps: number,
	entries: {
		key: string;
		rps: number;
		avgDurationMs?: number | null;
		errorRate?: number | null;
	}[],
	partial = false,
	avgDurationMs: number | null = null,
) => ({
	timestamp,
	partial,
	bucketSeconds: 60,
	requestCount: rps * 60,
	rps,
	avgDurationMs,
	avgTimeToFirstTokenMs: null,
	errorRate: null,
	clientErrorRate: null,
	entries: entries.map((entry) => ({
		key: entry.key,
		requestCount: entry.rps * 60,
		rps: entry.rps,
		avgDurationMs: entry.avgDurationMs ?? null,
		avgTimeToFirstTokenMs: null,
		errorRate: entry.errorRate ?? null,
		clientErrorRate: null,
	})),
});

describe("buildLoadChart", () => {
	it("pivots entries onto positional chart keys", () => {
		const chart = buildLoadChart({
			series: [
				{ key: "openai/gpt-5.6", label: "openai/gpt-5.6" },
				{ key: "anthropic/claude-fable-5", label: "anthropic/claude-fable-5" },
			],
			data: [
				point("2026-09-26T13:00:00Z", 5, [
					{ key: "openai/gpt-5.6", rps: 3 },
					{ key: "anthropic/claude-fable-5", rps: 2 },
				]),
			],
			totalKeys: 2,
		});

		expect(chart.series.map((s) => s.chartKey)).toEqual([
			"series_0",
			"series_1",
		]);
		expect(chart.rows[0]).toMatchObject({
			timestamp: "2026-09-26T13:00:00Z",
			series_0: 3,
			series_1: 2,
			total: 5,
			partial: false,
		});
		expect(chart.restCount).toBe(0);
	});

	it("folds the untracked remainder of each bucket into an Other series", () => {
		const chart = buildLoadChart({
			series: [{ key: "openai/gpt-5.6", label: "openai/gpt-5.6" }],
			data: [
				point("2026-09-26T13:00:00Z", 10, [{ key: "openai/gpt-5.6", rps: 4 }]),
			],
			totalKeys: 7,
		});

		expect(chart.restCount).toBe(6);
		expect(chart.series.at(-1)).toMatchObject({
			chartKey: "series_other",
			label: "Other (6)",
			sourceKey: null,
		});
		expect(chart.rows[0].series_other).toBe(6);
	});

	it("never renders a negative Other slice when entries exceed the total", () => {
		const chart = buildLoadChart({
			series: [{ key: "a", label: "a" }],
			data: [point("2026-09-26T13:00:00Z", 1, [{ key: "a", rps: 2 }])],
			totalKeys: 3,
		});
		expect(chart.rows[0].series_other).toBe(0);
	});

	it("carries the partial flag through so the trailing bucket can be marked", () => {
		const chart = buildLoadChart({
			series: [{ key: "a", label: "a" }],
			data: [
				point("2026-09-26T13:00:00Z", 1, [{ key: "a", rps: 1 }]),
				point("2026-09-26T13:01:00Z", 2, [{ key: "a", rps: 2 }], true),
			],
			totalKeys: 1,
		});
		expect(chart.rows.map((row) => row.partial)).toEqual([false, true]);
	});

	it("plots latency per series without an Other band", () => {
		const chart = buildLoadChart({
			series: [{ key: "a", label: "a" }],
			data: [
				point(
					"2026-09-26T13:00:00Z",
					10,
					[{ key: "a", rps: 4, avgDurationMs: 820 }],
					false,
					910,
				),
			],
			totalKeys: 7,
			metric: "duration",
		});

		// An average has no residual, so the ranked series must not be topped up
		// with a synthetic remainder the way the additive rps view is.
		expect(chart.restCount).toBe(0);
		expect(chart.series).toHaveLength(1);
		expect(chart.rows[0]).toMatchObject({ series_0: 820, total: 910 });
		expect(chart.rows[0].series_other).toBeUndefined();
	});

	it("leaves latency gaps null so the line breaks instead of dropping to zero", () => {
		const chart = buildLoadChart({
			series: [
				{ key: "a", label: "a" },
				{ key: "b", label: "b" },
			],
			data: [
				point(
					"2026-09-26T13:00:00Z",
					2,
					[{ key: "a", rps: 2, avgDurationMs: 500 }],
					false,
					500,
				),
			],
			totalKeys: 2,
			metric: "duration",
		});

		expect(chart.rows[0].series_0).toBe(500);
		expect(chart.rows[0].series_1).toBeNull();
	});

	it("plots the error rate per series, keeping a real 0% apart from a gap", () => {
		const chart = buildLoadChart({
			series: [
				{ key: "a", label: "a" },
				{ key: "b", label: "b" },
				{ key: "c", label: "c" },
			],
			data: [
				point("2026-09-26T13:00:00Z", 3, [
					{ key: "a", rps: 2, errorRate: 0.25 },
					{ key: "b", rps: 1, errorRate: 0 },
				]),
			],
			totalKeys: 5,
			metric: "errors",
		});

		expect(chart.restCount).toBe(0);
		expect(chart.rows[0]).toMatchObject({
			series_0: 0.25,
			series_1: 0,
			series_2: null,
		});
	});
});
