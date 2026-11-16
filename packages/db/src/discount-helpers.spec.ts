import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "./db.js";
import {
	getEffectiveDiscount,
	resolveEffectiveDiscount,
} from "./discount-helpers.js";
import { discount as discountTable } from "./schema.js";

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
	excludedCostTypes: [],
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

describe("excluded cost types", () => {
	it("returns the matched row's exclusions", () => {
		expect(
			resolveEffectiveDiscount(
				[
					{ ...discount, id: "other-org", organizationId: "other" },
					{
						...discount,
						id: "provider",
						provider: "carrier",
						excludedCostTypes: ["web_search"],
					},
				],
				[],
				"org",
				"carrier",
				"canonical",
			),
		).toMatchObject({
			discountId: "provider",
			excludedCostTypes: ["web_search"],
		});
	});

	it("takes exclusions from the winning row, not a broader one", () => {
		expect(
			resolveEffectiveDiscount(
				[
					{
						...discount,
						id: "global",
						provider: "carrier",
						excludedCostTypes: ["web_search"],
					},
					{
						...discount,
						id: "org",
						organizationId: "org",
						provider: "carrier",
					},
				],
				[],
				"org",
				"carrier",
				"canonical",
			),
		).toMatchObject({ discountId: "org", excludedCostTypes: [] });
	});

	it("excludes nothing for Airside and missing discounts", () => {
		expect(
			resolveEffectiveDiscount([], [carrier], null, "carrier", "canonical")
				.excludedCostTypes ?? [],
		).toEqual([]);
		expect(
			resolveEffectiveDiscount([], [], null, "carrier", "canonical")
				.excludedCostTypes ?? [],
		).toEqual([]);
	});

	describe("getEffectiveDiscount", () => {
		const ids = ["discount-excl-spec-a", "discount-excl-spec-b"];

		afterEach(async () => {
			await db.delete(discountTable).where(inArray(discountTable.id, ids));
		});

		it("loads exclusions from the database, defaulting to none", async () => {
			await db.insert(discountTable).values([
				{
					id: ids[0],
					provider: "google-vertex",
					model: "gemini-2.5-pro",
					discountPercent: "0.5",
					excludedCostTypes: ["web_search"],
				},
				{
					id: ids[1],
					provider: "google-vertex",
					model: "gemini-2.5-flash",
					discountPercent: "0.5",
				},
			]);

			expect(
				await getEffectiveDiscount(null, "google-vertex", "gemini-2.5-pro"),
			).toMatchObject({
				discount: "0.5",
				source: "global_provider_model",
				excludedCostTypes: ["web_search"],
			});
			expect(
				await getEffectiveDiscount(null, "google-vertex", "gemini-2.5-flash"),
			).toMatchObject({ discount: "0.5", excludedCostTypes: [] });
		});
	});
});
