import { describe, expect, it } from "vitest";

import {
	cachedInputPriceWarning,
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

describe("cached input price warning", () => {
	it.each([
		["2", "0.2"],
		["2e-6", "1e-6"],
		["2", ""],
		["", "0.5"],
		["2", "not a price"],
	])("accepts input %s with cached %s", (input, cached) => {
		expect(cachedInputPriceWarning(input, cached)).toBeNull();
	});

	it("warns when cached input is over half the input price", () => {
		expect(cachedInputPriceWarning("2e-6", "1.8e-6")).toMatch(
			/^Cached input costs 90% of the input price\. It is usually much cheaper/,
		);
	});

	it("warns when cached input costs as much as input or more", () => {
		expect(cachedInputPriceWarning("0.15", "0.3")).toMatch(
			/^Cached input costs 200% of the input price\. Cached input is usually much cheaper/,
		);
	});
});
