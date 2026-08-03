import { afterEach, describe, expect, it, vi } from "vitest";

import { models } from "@llmgateway/models";

import {
	getValidationModel,
	pickCheapestRecentModel,
	validateProviderKey,
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

describe("validateProviderKey error reporting", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function mockUpstream(status: number, body: unknown) {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}

	// A provider can answer 401 for a perfectly valid key that simply lacks
	// entitlement to the validation model (AWS Bedrock does exactly this). The
	// reason must reach the caller instead of being flattened into a generic
	// "invalid API key", which sends users chasing the wrong problem.
	it("forwards the upstream message on a 401", async () => {
		const message =
			"openai.gpt-5.6-luna is not available for this account. You can explore other available models on Amazon Bedrock.";
		mockUpstream(401, { error: { message } });

		const result = await validateProviderKey(
			"aws-mantle",
			"ABSKtest",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.statusCode).toBe(401);
		expect(result.error).toBe(message);
	});

	it("still forwards the upstream message on non-401 failures", async () => {
		mockUpstream(429, { error: { message: "Rate limit exceeded" } });

		const result = await validateProviderKey(
			"openai",
			"sk-test",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.statusCode).toBe(429);
		expect(result.error).toBe("Rate limit exceeded");
	});

	it("falls back to status text when the body carries no message", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("not json", { status: 401, statusText: "Unauthorized" }),
		);

		const result = await validateProviderKey(
			"openai",
			"sk-test",
			undefined,
			false,
		);

		expect(result.valid).toBe(false);
		expect(result.error).toBe("401 Unauthorized");
	});
});
