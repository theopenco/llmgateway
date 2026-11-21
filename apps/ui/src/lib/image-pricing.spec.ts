import { describe, expect, it } from "vitest";

import {
	buildImageModelRows,
	formatImagePrice,
	mappingImagePrice,
} from "./image-pricing";

import type { ApiModel, ApiModelProviderMapping } from "./fetch-models";

function mapping(
	overrides: Partial<ApiModelProviderMapping>,
): ApiModelProviderMapping {
	return {
		providerId: "provider-a",
		perImagePrice: null,
		imageOutputPrice: null,
		imageOutputTokensByResolution: null,
		requestPrice: null,
		discount: null,
		deactivatedAt: null,
		...overrides,
	} as ApiModelProviderMapping;
}

function model(
	id: string,
	output: string[],
	mappings: ApiModelProviderMapping[],
): ApiModel {
	return { id, name: id, family: "lab", output, mappings } as ApiModel;
}

describe("mappingImagePrice", () => {
	it("takes the cheapest flat tier and applies the discount", () => {
		expect(
			mappingImagePrice(
				mapping({
					perImagePrice: { "1K": "0.04", "4K": "0.12" },
					discount: "0.5",
				}),
			),
		).toBeCloseTo(0.02, 10);
	});

	it("derives a price from image-output tokens when there is no flat tier", () => {
		expect(
			mappingImagePrice(
				mapping({
					imageOutputPrice: "30e-6",
					imageOutputTokensByResolution: { "1K": 1000, "2K": 2000 },
				}),
			),
		).toBeCloseTo(0.03, 10);
	});

	it("uses a flat request price when that is how the model bills", () => {
		expect(mappingImagePrice(mapping({ requestPrice: "0.09" }))).toBeCloseTo(
			0.09,
			10,
		);
		expect(mappingImagePrice(mapping({ requestPrice: "0" }))).toBeNull();
	});

	it("returns null when the mapping has no image price", () => {
		expect(mappingImagePrice(mapping({}))).toBeNull();
		expect(
			mappingImagePrice(mapping({ imageOutputPrice: "30e-6" })),
		).toBeNull();
	});
});

describe("buildImageModelRows", () => {
	const now = new Date("2026-01-10T00:00:00Z");

	it("lists routable image models cheapest first, unpriced last", () => {
		const rows = buildImageModelRows(
			[
				model("text-only", ["text"], [mapping({})]),
				model("unpriced", ["image"], [mapping({})]),
				model("pricey", ["image"], [mapping({ perImagePrice: { a: "0.2" } })]),
				model(
					"cheap",
					["text", "image"],
					[
						mapping({ perImagePrice: { a: "0.05" } }),
						mapping({
							providerId: "provider-b",
							perImagePrice: { a: "0.01" },
						}),
					],
				),
			],
			now,
		);
		expect(rows.map((row) => row.id)).toEqual(["cheap", "pricey", "unpriced"]);
		expect(rows[0]).toMatchObject({ providerCount: 2, fromPrice: 0.01 });
		expect(rows[2].fromPrice).toBeNull();
	});

	it("ignores deactivated mappings and drops models with none left", () => {
		const rows = buildImageModelRows(
			[
				model(
					"retired",
					["image"],
					[
						mapping({
							perImagePrice: { a: "0.01" },
							deactivatedAt: "2026-01-01T00:00:00Z",
						}),
					],
				),
				model(
					"partly",
					["image"],
					[
						mapping({
							perImagePrice: { a: "0.01" },
							deactivatedAt: "2026-01-01T00:00:00Z",
						}),
						mapping({
							providerId: "provider-b",
							perImagePrice: { a: "0.03" },
							deactivatedAt: "2026-02-01T00:00:00Z",
						}),
					],
				),
			],
			now,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: "partly",
			providerCount: 1,
			fromPrice: 0.03,
		});
	});
});

describe("formatImagePrice", () => {
	it("trims trailing zeros", () => {
		expect(formatImagePrice(0.04)).toBe("$0.04");
		expect(formatImagePrice(0.00256)).toBe("$0.0026");
	});
});
