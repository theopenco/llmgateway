import { describe, expect, it } from "vitest";

import {
	gateProviderStats,
	hasEnoughRequestsForStats,
	MIN_REQUESTS_FOR_STATS,
} from "./provider-stats";

describe("hasEnoughRequestsForStats", () => {
	it("requires strictly more requests than the threshold", () => {
		expect(hasEnoughRequestsForStats(0)).toBe(false);
		expect(hasEnoughRequestsForStats(MIN_REQUESTS_FOR_STATS)).toBe(false);
		expect(hasEnoughRequestsForStats(MIN_REQUESTS_FOR_STATS + 1)).toBe(true);
	});
});

describe("gateProviderStats", () => {
	it("nulls derived stats below the threshold so small samples are hidden", () => {
		const gated = gateProviderStats({
			logsCount: 8,
			uptime: 100,
			avgTimeToFirstToken: 63470,
			throughput: 12,
		});
		expect(gated).toEqual({
			logsCount: 8,
			uptime: null,
			avgTimeToFirstToken: null,
			throughput: null,
		});
	});

	it("keeps derived stats once the sample is large enough", () => {
		const stats = {
			logsCount: MIN_REQUESTS_FOR_STATS + 1,
			uptime: 99.7,
			avgTimeToFirstToken: 412,
			throughput: 85,
		};
		expect(gateProviderStats(stats)).toEqual(stats);
	});
});
