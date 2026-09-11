import { describe, expect, it } from "vitest";

import { resolveEffectiveDiscount } from "./discount-helpers.js";

type Discount = Parameters<typeof resolveEffectiveDiscount>[0][number];

const carrier = {
	id: "carrier-discount",
	providerId: "carrier",
	modelId: null,
	discountPercent: "0.2",
};

const discount: Discount = {
	id: "platform-discount",
	organizationId: null,
	provider: null,
	model: null,
	discountPercent: "0.1",
	expiresAt: null,
};

describe("Airside discounts", () => {
	it("inherits carrier fares and respects canonical model overrides", () => {
		const settings = [
			carrier,
			{
				...carrier,
				id: "model-discount",
				modelId: "canonical",
				discountPercent: "0.3",
			},
		];
		expect(
			resolveEffectiveDiscount([], settings, null, "carrier", "canonical"),
		).toMatchObject({ discount: "0.3", source: "airside_provider_model" });
		expect(
			resolveEffectiveDiscount([], settings, null, "carrier", "upstream-id"),
		).toMatchObject({ discount: "0.2", source: "airside_provider" });
		expect(
			resolveEffectiveDiscount(
				[],
				settings,
				null,
				"another-carrier",
				"canonical",
			).discount,
		).toBe("0");
	});

	it("lets a zero model override disable the carrier discount", () => {
		const settings = [
			carrier,
			{ ...carrier, modelId: "canonical", discountPercent: "0" },
		];
		expect(
			resolveEffectiveDiscount([], settings, null, "carrier", "canonical")
				.discount,
		).toBe("0");
		expect(
			resolveEffectiveDiscount([], settings, null, "carrier", "sibling")
				.discount,
		).toBe("0.2");
	});

	it.each([
		{ organizationId: "org", provider: "carrier", model: "canonical" },
		{ organizationId: "org", provider: "carrier", model: null },
		{ organizationId: "org", provider: null, model: "canonical" },
		{ organizationId: null, provider: "carrier", model: "canonical" },
		{ organizationId: null, provider: "carrier", model: null },
		{ organizationId: null, provider: null, model: "canonical" },
		{ organizationId: null, provider: null, model: null },
	])("preserves explicit discount precedence: %j", (scope) => {
		expect(
			resolveEffectiveDiscount(
				[{ ...discount, ...scope }],
				[carrier],
				"org",
				"carrier",
				"canonical",
			).discount,
		).toBe("0.1");
	});

	it("ignores expired and invalid overrides and other organizations", () => {
		const overrides = [
			{ ...discount, expiresAt: new Date(0) },
			{ ...discount, discountPercent: "1.2" },
			{ ...discount, discountPercent: "NaN" },
			{ ...discount, organizationId: "other-org", provider: "carrier" },
		];
		expect(
			resolveEffectiveDiscount(
				overrides,
				[carrier],
				"org",
				"carrier",
				"canonical",
			).discount,
		).toBe("0.2");
	});

	it("lets an explicit zero discount disable Airside savings", () => {
		expect(
			resolveEffectiveDiscount(
				[{ ...discount, discountPercent: "0" }],
				[carrier],
				null,
				"carrier",
				"canonical",
			).discount,
		).toBe("0");
	});
});
