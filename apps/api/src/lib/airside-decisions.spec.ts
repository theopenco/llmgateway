import { describe, expect, it } from "vitest";

import {
	assertDecisionMetadataEdit,
	assertDecisionPricing,
	assertDecisionProvider,
} from "./airside-decisions.js";

describe("airside decision listing rules", () => {
	it("keeps System One decision providers off Airside decision listings", () => {
		expect(() => assertDecisionProvider("typesafe", true)).toThrow(
			"System One",
		);
		expect(() => assertDecisionProvider("azure", true)).toThrow("System One");
		expect(() => assertDecisionProvider("typesafe", false)).not.toThrow();
		expect(() => assertDecisionProvider("acme-decide", true)).not.toThrow();
	});

	it("allows only input and per-request prices on decision listings", () => {
		expect(() =>
			assertDecisionPricing(true, { outputPrice: "0", cachedInputPrice: null }),
		).not.toThrow();
		expect(() => assertDecisionPricing(true, { outputPrice: "1e-6" })).toThrow(
			"output price of 0",
		);
		expect(() =>
			assertDecisionPricing(true, {
				outputPrice: "0",
				regionPrices: [{ region: "eu" }],
			}),
		).toThrow("regional");
		expect(() =>
			assertDecisionPricing(false, { outputPrice: "1e-6" }),
		).not.toThrow();
	});

	it("accepts pinned chat fields but rejects claimed ones", () => {
		expect(() =>
			assertDecisionMetadataEdit(true, {
				tools: false,
				reasoningEfforts: [],
				contextSize: 8000,
			}),
		).not.toThrow();
		expect(() => assertDecisionMetadataEdit(true, { reasoning: true })).toThrow(
			"reasoning",
		);
	});
});
