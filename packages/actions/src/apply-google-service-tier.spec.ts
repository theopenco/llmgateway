import { describe, expect, it } from "vitest";

import { applyGoogleServiceTier } from "./apply-google-service-tier.js";

import type { GoogleRequestBody } from "@llmgateway/models";

function googleBody(): GoogleRequestBody {
	return { contents: [] };
}

describe("applyGoogleServiceTier", () => {
	it("injects flex into the body for google-ai-studio", () => {
		const body = googleBody();
		applyGoogleServiceTier(body, "google-ai-studio", "flex");
		expect(body.service_tier).toBe("flex");
	});

	it("injects priority into the body for glacier", () => {
		const body = googleBody();
		applyGoogleServiceTier(body, "glacier", "priority");
		expect(body.service_tier).toBe("priority");
	});

	it("does not inject for vertex (handled via header instead)", () => {
		const body = googleBody();
		applyGoogleServiceTier(body, "google-vertex", "priority");
		expect(body.service_tier).toBeUndefined();
	});

	it("ignores standard/default/auto and missing tiers", () => {
		for (const tier of ["default", "auto", undefined]) {
			const body = googleBody();
			applyGoogleServiceTier(body, "google-ai-studio", tier);
			expect(body.service_tier).toBeUndefined();
		}
	});

	it("does not inject for non-google providers", () => {
		const body = googleBody();
		applyGoogleServiceTier(body, "openai", "flex");
		expect(body.service_tier).toBeUndefined();
	});

	it("is a no-op for FormData bodies", () => {
		const form = new FormData();
		expect(() =>
			applyGoogleServiceTier(form, "google-ai-studio", "flex"),
		).not.toThrow();
		expect(form.has("service_tier")).toBe(false);
	});
});
