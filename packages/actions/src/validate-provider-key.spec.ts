import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	getValidationModel,
	pickCheapestRecentModel,
} from "./validate-provider-key.js";

describe("getValidationModel", () => {
	it("never selects an OCR model for provider key validation", () => {
		// The OCR model has zero token prices, which would otherwise make it the
		// cheapest (first) candidate. It must be excluded so key validation calls
		// the chat-completions endpoint with a real chat model.
		const selected = getValidationModel("mistral");
		expect(selected).not.toBeNull();
		expect(selected?.modelId).not.toBe("mistral-ocr-latest");

		const selectedDef = models.find((m) => m.id === selected?.modelId);
		const usesOcr = selectedDef?.providers.some(
			(p) => p.providerId === "mistral" && (p as { ocr?: boolean }).ocr,
		);
		expect(usesOcr).toBeFalsy();
	});

	it("selects a model from the newer half of the provider's releases", () => {
		const selected = getValidationModel("openai");
		expect(selected).not.toBeNull();

		const selectedDef = models.find((m) => m.id === selected?.modelId);
		const releasedAt =
			selectedDef && "releasedAt" in selectedDef
				? (selectedDef.releasedAt as Date | undefined)
				: undefined;
		expect(releasedAt).toBeDefined();

		const datedReleases = models
			.filter((m) => "releasedAt" in m && m.releasedAt !== undefined)
			.filter((m) =>
				m.providers.some(
					(p) =>
						p.providerId === "openai" &&
						!("deprecatedAt" in p && p.deprecatedAt) &&
						!("deactivatedAt" in p && p.deactivatedAt),
				),
			)
			.map((m) => (m.releasedAt as Date).getTime());
		const olderOrSame = datedReleases.filter(
			(t) => t <= releasedAt!.getTime(),
		).length;
		// The pick must not be in the older half of the catalog
		expect(olderOrSame * 2).toBeGreaterThanOrEqual(datedReleases.length);
	});
});

describe("pickCheapestRecentModel", () => {
	it("returns undefined for an empty list", () => {
		expect(pickCheapestRecentModel([])).toBeUndefined();
	});

	it("picks the cheapest recent model over a cheaper outdated one", () => {
		const picked = pickCheapestRecentModel([
			{ id: "old-cheap", price: 0.1, releasedAt: new Date("2024-01-01") },
			{ id: "older", price: 0.5, releasedAt: new Date("2023-06-01") },
			{ id: "new-cheap", price: 0.3, releasedAt: new Date("2025-05-01") },
			{ id: "new-pricey", price: 2, releasedAt: new Date("2025-06-01") },
		]);
		expect(picked?.id).toBe("new-cheap");
	});

	it("falls back to the cheapest model when release dates are unknown", () => {
		const picked = pickCheapestRecentModel([
			{ id: "pricey", price: 2 },
			{ id: "cheap", price: 0.1 },
		]);
		expect(picked?.id).toBe("cheap");
	});

	it("ignores undated models when dated candidates exist", () => {
		const picked = pickCheapestRecentModel([
			{ id: "undated-cheap", price: 0.01 },
			{ id: "new", price: 1, releasedAt: new Date("2025-05-01") },
			{ id: "old", price: 0.5, releasedAt: new Date("2023-01-01") },
		]);
		expect(picked?.id).toBe("new");
	});
});
