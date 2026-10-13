import { describe, expect, it } from "vitest";

import {
	getContextSizeDeviation,
	getContextTierMinSize,
	getReferenceContextSize,
} from "./context-tier.js";
import { models, type ProviderModelMapping } from "./models.js";

function mapping(
	providerId: string,
	contextSize: number | undefined,
	extra: Partial<ProviderModelMapping> = {},
): ProviderModelMapping {
	return {
		providerId,
		externalId: "x",
		contextSize,
		...extra,
	} as ProviderModelMapping;
}

const UNKNOWN_MODEL = "not-a-catalogue-model";

describe("getReferenceContextSize", () => {
	it("uses the largest active catalogue window, ignoring self-reported listings", () => {
		const catalogueModel = models.find((model) => model.id === "glm-5.3-flash");
		const largest = Math.max(
			...(catalogueModel?.providers ?? []).map((p) => p.contextSize ?? 0),
		);
		expect(
			getReferenceContextSize("glm-5.3-flash", [mapping("airside", 4_000_000)]),
		).toBe(largest);
	});

	it("falls back to the given mappings for models outside the catalogue", () => {
		expect(
			getReferenceContextSize(UNKNOWN_MODEL, [
				mapping("a", 200_000),
				mapping("b", 1_000_000),
				mapping("c", 2_000_000, { deactivatedAt: new Date("2020-01-01") }),
			]),
		).toBe(1_000_000);
	});

	it("counts regional context overrides", () => {
		expect(
			getReferenceContextSize(UNKNOWN_MODEL, [
				mapping("a", 200_000, {
					regions: [{ id: "eu", contextSize: 400_000 }],
				}),
			]),
		).toBe(400_000);
	});
});

describe("getContextTierMinSize", () => {
	it("admits windows within 10% of the reference", () => {
		const minSize = getContextTierMinSize(UNKNOWN_MODEL, [
			mapping("a", 1_050_000),
			mapping("b", 1_000_000),
			mapping("c", 200_000),
		]);
		expect(minSize).toBeCloseTo(945_000);
		expect(1_000_000 >= (minSize ?? 0)).toBe(true);
		expect(200_000 >= (minSize ?? 0)).toBe(false);
	});

	it("does not apply when fewer than two providers serve the full window", () => {
		expect(
			getContextTierMinSize(UNKNOWN_MODEL, [
				mapping("a", 1_000_000, { regions: [{ id: "eu" }] }),
				mapping("b", 200_000),
			]),
		).toBeUndefined();
	});

	it("does not apply without any known window", () => {
		expect(
			getContextTierMinSize(UNKNOWN_MODEL, [
				mapping("a", undefined),
				mapping("b", undefined),
			]),
		).toBeUndefined();
	});
});

describe("getContextSizeDeviation", () => {
	it("flags windows more than 10% away from the reference", () => {
		expect(getContextSizeDeviation(200_000, 1_048_576)).toBe("below");
		expect(getContextSizeDeviation(1_000_000, 1_048_576)).toBeUndefined();
		expect(getContextSizeDeviation(2_000_000, 1_048_576)).toBe("above");
		expect(getContextSizeDeviation(null, 1_048_576)).toBeUndefined();
		expect(getContextSizeDeviation(200_000, undefined)).toBeUndefined();
	});
});
