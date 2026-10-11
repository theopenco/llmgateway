import { describe, expect, it } from "vitest";

import {
	cacheRateStatus,
	promptCacheRate,
	resolveUsageBucket,
} from "./prompt-cache";

describe("prompt cache rate", () => {
	it("distinguishes missing input, small samples, and actual cache misses", () => {
		expect(
			promptCacheRate({
				requestCount: 4,
				inputTokens: 1000,
				cachedTokens: 500,
			}),
		).toBeNull();
		expect(
			cacheRateStatus({
				requestCount: 4,
				inputTokens: 1000,
				cachedTokens: 500,
			}),
		).toBe("Insufficient traffic");
		expect(
			promptCacheRate({ requestCount: 5, inputTokens: 1000, cachedTokens: 0 }),
		).toBe(0);
		expect(
			promptCacheRate({
				requestCount: 5,
				inputTokens: 1000,
				cachedTokens: 1000,
			}),
		).toBe(100);
		expect(
			cacheRateStatus({ requestCount: 10, inputTokens: 0, cachedTokens: 0 }),
		).toBe("No input tokens");
	});
	it("calculates a token-weighted rate from combined counts", () => {
		expect(
			promptCacheRate({
				requestCount: 6,
				inputTokens: 100 + 900,
				cachedTokens: 100,
			}),
		).toBe(10);
	});
	it("keeps daily overrides and falls back to daily on long ranges", () => {
		expect(resolveUsageBucket("auto", "cacheRate", 30)).toBe("hour");
		expect(resolveUsageBucket("auto", "cost", 7)).toBe("day");
		expect(resolveUsageBucket("day", "cacheRate", 7)).toBe("day");
		expect(resolveUsageBucket("hour", "cacheRate", 31)).toBe("day");
	});
});
