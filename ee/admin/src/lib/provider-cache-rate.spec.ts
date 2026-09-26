import { describe, expect, it } from "vitest";

import {
	formatProviderCacheRate,
	providerCacheRate,
} from "./provider-cache-rate";

describe("providerCacheRate", () => {
	it("uses total input tokens, which already include cached tokens", () => {
		expect(providerCacheRate({ inputTokens: 1000, cachedTokens: 750 })).toBe(
			75,
		);
	});

	it("distinguishes no input from an input cache miss", () => {
		expect(
			formatProviderCacheRate(
				providerCacheRate({ inputTokens: 0, cachedTokens: 0 }),
			),
		).toBe("—");
		expect(
			formatProviderCacheRate(
				providerCacheRate({ inputTokens: 1000, cachedTokens: 0 }),
			),
		).toBe("0.0%");
	});

	it("shows fully cached input as 100%", () => {
		expect(
			formatProviderCacheRate(
				providerCacheRate({ inputTokens: 1000, cachedTokens: 1000 }),
			),
		).toBe("100.0%");
	});
});
