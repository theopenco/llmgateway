import { describe, expect, it } from "vitest";

import { tokenBreakdown } from "./token-usage";

describe("token breakdown", () => {
	it("counts cache reads separately without double counting writes", () => {
		const result = tokenBreakdown({
			inputTokens: 1000,
			cachedTokens: 600,
			cacheWriteTokens: 100,
			outputTokens: 200,
		});
		expect(result).toEqual({
			input: 400,
			cache: 600,
			output: 200,
			cacheWrites: 100,
		});
		expect(result.input + result.cache + result.output).toBe(1200);
	});
	it("does not display negative input for inconsistent historical counters", () => {
		expect(
			tokenBreakdown({
				inputTokens: 0,
				cachedTokens: 10,
				cacheWriteTokens: 0,
				outputTokens: 0,
			}).input,
		).toBe(0);
	});
});
