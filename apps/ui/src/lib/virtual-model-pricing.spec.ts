import { describe, expect, it } from "vitest";

import { getVirtualModelPricing } from "./virtual-model-pricing";

import type { ProviderModelMapping } from "@llmgateway/models";

const mapping: ProviderModelMapping = {
	providerId: "typesafe",
	streaming: true,
	externalId: "jev",
	inputPrice: "0.042e-6",
	outputPrice: "0.3e-6",
};
describe("virtual model current-cut pricing", () => {
	it("uses exact per-million prices and canonical discounts", () => {
		expect(
			getVirtualModelPricing(
				"jev-1.14.0",
				[mapping],
				[
					{
						id: "fixture",
						provider: "typesafe",
						model: "jev-1.14.0",
						discountPercent: "0.1",
						reason: null,
						expiresAt: null,
						createdAt: "2026-01-01",
					},
				],
			),
		).toEqual({ input: "0.0378", output: "0.27" });
	});
	it("ignores deactivated mappings and missing prices", () => {
		expect(
			getVirtualModelPricing("jev-1.14.0", [
				{ ...mapping, deactivatedAt: new Date("2020-01-01") },
			]),
		).toEqual({ input: null, output: null });
		expect(
			getVirtualModelPricing("jev-1.14.0", [
				{ ...mapping, inputPrice: undefined, outputPrice: undefined },
			]),
		).toEqual({ input: null, output: null });
	});
	it("preserves free prices and takes the lowest active price", () => {
		expect(
			getVirtualModelPricing("jev-1.14.0", [
				mapping,
				{ ...mapping, inputPrice: "0" },
			]),
		).toEqual({ input: "0", output: "0.3" });
	});
});
