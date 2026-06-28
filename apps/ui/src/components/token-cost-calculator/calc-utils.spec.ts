import { describe, expect, it } from "vitest";

import {
	computeRowCost,
	formatTokenCount,
	formatUsd,
	getCheapestProvider,
	getModelById,
	getPopularModels,
	getTextModels,
	weightedTokenCost,
} from "./calc-utils";

describe("formatUsd", () => {
	it("renders zero and non-finite values as $0", () => {
		expect(formatUsd(0)).toBe("$0");
		expect(formatUsd(Number.NaN)).toBe("$0");
		expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("$0");
	});

	it("keeps sub-cent costs meaningful instead of rounding to $0.00", () => {
		// A single small prompt should never collapse to $0.00.
		expect(formatUsd(0.00015)).not.toBe("$0.00");
		expect(formatUsd(0.00015)).toMatch(/^\$0\.000\d/);
	});

	it("uses compact suffixes for large figures", () => {
		expect(formatUsd(1)).toBe("$1.00");
		expect(formatUsd(1_500)).toBe("$1.50K");
		expect(formatUsd(25_000)).toBe("$25.0K");
		expect(formatUsd(2_500_000)).toBe("$2.50M");
	});
});

describe("formatTokenCount", () => {
	it("formats counts with K/M suffixes", () => {
		expect(formatTokenCount(950)).toBe("950");
		expect(formatTokenCount(1_500)).toBe("1.5K");
		expect(formatTokenCount(12_000)).toBe("12K");
		expect(formatTokenCount(2_000_000)).toBe("2.0M");
	});
});

describe("computeRowCost", () => {
	const model = getModelById("gpt-4o-mini");

	it("has the gpt-4o-mini fixture available", () => {
		expect(model).toBeDefined();
	});

	it("computes official cost = input*inPrice + output*outPrice", () => {
		if (!model) {
			return;
		}
		const inputTokens = 1_000_000;
		const outputTokens = 100_000;
		const cost = computeRowCost(model, inputTokens, outputTokens);

		const official = cost.officialMapping;
		expect(official).toBeDefined();
		const expectedInput = Number(official?.inputPrice ?? "0") * inputTokens;
		const expectedOutput = Number(official?.outputPrice ?? "0") * outputTokens;
		expect(cost.officialCost).toBeCloseTo(expectedInput + expectedOutput, 10);
	});

	it("never charges more via the gateway than the official provider", () => {
		if (!model) {
			return;
		}
		const cost = computeRowCost(model, 500_000, 50_000);
		expect(cost.gatewayCost).toBeLessThanOrEqual(cost.officialCost + 1e-12);
	});

	it("reports zero cost for zero tokens without marking the row unpriced", () => {
		if (!model) {
			return;
		}
		const cost = computeRowCost(model, 0, 0);
		expect(cost.officialCost).toBe(0);
		expect(cost.gatewayCost).toBe(0);
		expect(cost.unpriced).toBe(false);
	});
});

describe("getCheapestProvider", () => {
	it("returns the provider with the lowest weighted cost for the token mix", () => {
		const model = getModelById("gpt-4o-mini");
		if (!model) {
			return;
		}
		const cheapest = getCheapestProvider(model, 1_000_000, 100_000);
		expect(cheapest).toBeDefined();

		const cheapestCost = weightedTokenCost(cheapest!, 1_000_000, 100_000);
		for (const p of model.providers) {
			if (p.inputPrice === undefined && p.outputPrice === undefined) {
				continue;
			}
			expect(cheapestCost).toBeLessThanOrEqual(
				weightedTokenCost(p, 1_000_000, 100_000) + 1e-12,
			);
		}
	});
});

describe("model catalog helpers", () => {
	it("returns a non-empty set of priced popular models", () => {
		const popular = getPopularModels();
		expect(popular.length).toBeGreaterThan(5);
		for (const m of popular) {
			const cost = computeRowCost(m, 1000, 500);
			expect(cost.unpriced).toBe(false);
		}
	});

	it("excludes image and video models from the text list", () => {
		const text = getTextModels();
		expect(text.length).toBeGreaterThan(50);
		for (const m of text) {
			expect(m.output?.includes("image")).not.toBe(true);
			expect(m.output?.includes("video")).not.toBe(true);
		}
	});
});
