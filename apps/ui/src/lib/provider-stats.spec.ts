import { describe, expect, it } from "vitest";

import {
	gateProviderStats,
	hasEnoughRequestsForStats,
	hasEnoughTtftSamplesForStats,
	MIN_REQUESTS_FOR_STATS,
	MIN_TTFT_SAMPLES_FOR_STATS,
} from "./provider-stats";

describe("hasEnoughRequestsForStats", () => {
	it("requires strictly more requests than the threshold", () => {
		expect(hasEnoughRequestsForStats(0)).toBe(false);
		expect(hasEnoughRequestsForStats(MIN_REQUESTS_FOR_STATS)).toBe(false);
		expect(hasEnoughRequestsForStats(MIN_REQUESTS_FOR_STATS + 1)).toBe(true);
	});
});

describe("hasEnoughTtftSamplesForStats", () => {
	it("requires strictly more samples than the threshold", () => {
		expect(hasEnoughTtftSamplesForStats(0)).toBe(false);
		expect(hasEnoughTtftSamplesForStats(MIN_TTFT_SAMPLES_FOR_STATS)).toBe(
			false,
		);
		expect(hasEnoughTtftSamplesForStats(MIN_TTFT_SAMPLES_FOR_STATS + 1)).toBe(
			true,
		);
	});
});

describe("gateProviderStats", () => {
	it("nulls derived stats below the threshold so small samples are hidden", () => {
		const gated = gateProviderStats({
			logsCount: 8,
			uptime: 100,
			avgTimeToFirstToken: 63470,
			timeToFirstTokenCount: 8,
			throughput: 12,
		});
		expect(gated).toEqual({
			logsCount: 8,
			uptime: null,
			avgTimeToFirstToken: null,
			throughput: null,
		});
	});

	it("keeps derived stats once both samples are large enough", () => {
		const gated = gateProviderStats({
			logsCount: MIN_REQUESTS_FOR_STATS + 1,
			uptime: 99.7,
			avgTimeToFirstToken: 412,
			timeToFirstTokenCount: MIN_TTFT_SAMPLES_FOR_STATS + 1,
			throughput: 85,
		});
		expect(gated).toEqual({
			logsCount: MIN_REQUESTS_FOR_STATS + 1,
			uptime: 99.7,
			avgTimeToFirstToken: 412,
			throughput: 85,
		});
	});

	// The case this gating exists for: plenty of traffic, but almost none of it
	// streamed, so the TTFT average rests on a handful of samples even though the
	// request count sails past MIN_REQUESTS_FOR_STATS.
	it("hides TTFT when few requests were streamed but keeps request-based stats", () => {
		const gated = gateProviderStats({
			logsCount: 5000,
			uptime: 99.9,
			avgTimeToFirstToken: 63470,
			timeToFirstTokenCount: 3,
			throughput: 85,
		});
		expect(gated).toEqual({
			logsCount: 5000,
			uptime: 99.9,
			avgTimeToFirstToken: null,
			throughput: 85,
		});
	});

	// Converse: a low-traffic provider whose every request was streamed still has
	// no meaningful uptime, and not enough TTFT samples either.
	it("hides both when traffic is low even if every request was streamed", () => {
		const gated = gateProviderStats({
			logsCount: 40,
			uptime: 100,
			avgTimeToFirstToken: 300,
			timeToFirstTokenCount: 40,
			throughput: 90,
		});
		expect(gated).toEqual({
			logsCount: 40,
			uptime: null,
			avgTimeToFirstToken: null,
			throughput: null,
		});
	});

	// A provider can clear the streamed-sample bar while still being low-traffic
	// overall; every stat stays hidden so surfaces show one consistent
	// "stats hidden until N requests" state instead of a lone TTFT.
	it("hides TTFT below the request threshold despite enough samples", () => {
		const gated = gateProviderStats({
			logsCount: MIN_TTFT_SAMPLES_FOR_STATS + 50,
			uptime: 100,
			avgTimeToFirstToken: 114820,
			timeToFirstTokenCount: MIN_TTFT_SAMPLES_FOR_STATS + 50,
			throughput: 12,
		});
		expect(gated).toEqual({
			logsCount: MIN_TTFT_SAMPLES_FOR_STATS + 50,
			uptime: null,
			avgTimeToFirstToken: null,
			throughput: null,
		});
	});
});
