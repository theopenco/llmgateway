import { describe, expect, it } from "vitest";

import {
	applyGoogleServiceTier,
	isPremiumServiceTier,
	providerKeyBaseUrlSupportsServiceTier,
	resolveServedServiceTier,
} from "./apply-google-service-tier.js";

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

describe("resolveServedServiceTier", () => {
	it("maps Vertex trafficType to a tier id", () => {
		expect(
			resolveServedServiceTier({ trafficType: "ON_DEMAND_PRIORITY" }),
		).toBe("priority");
		expect(resolveServedServiceTier({ trafficType: "ON_DEMAND_FLEX" })).toBe(
			"flex",
		);
	});

	it("treats a downgraded Vertex response (ON_DEMAND) as standard", () => {
		expect(resolveServedServiceTier({ trafficType: "ON_DEMAND" })).toBeNull();
	});

	it("maps the AI Studio x-gemini-service-tier header to a tier id", () => {
		expect(resolveServedServiceTier({ serviceTierHeader: "priority" })).toBe(
			"priority",
		);
		expect(resolveServedServiceTier({ serviceTierHeader: "flex" })).toBe(
			"flex",
		);
		expect(
			resolveServedServiceTier({ serviceTierHeader: "standard" }),
		).toBeNull();
	});

	it("maps the AI Studio usageMetadata.serviceTier body field to a tier id", () => {
		// Streaming AI Studio responses omit the header and carry the served tier
		// in the body instead.
		expect(resolveServedServiceTier({ serviceTierBody: "flex" })).toBe("flex");
		expect(resolveServedServiceTier({ serviceTierBody: "priority" })).toBe(
			"priority",
		);
		expect(
			resolveServedServiceTier({ serviceTierBody: "standard" }),
		).toBeNull();
	});

	it("prefers the header but falls back to the body field", () => {
		expect(
			resolveServedServiceTier({
				serviceTierHeader: null,
				serviceTierBody: "flex",
			}),
		).toBe("flex");
	});

	it("returns null when no signals are present", () => {
		expect(resolveServedServiceTier({})).toBeNull();
		expect(
			resolveServedServiceTier({
				trafficType: null,
				serviceTierHeader: null,
				serviceTierBody: null,
			}),
		).toBeNull();
	});
});

describe("isPremiumServiceTier", () => {
	it("accepts only flex and priority", () => {
		expect(isPremiumServiceTier("flex")).toBe(true);
		expect(isPremiumServiceTier("priority")).toBe(true);
		for (const tier of ["auto", "default", "", null, undefined]) {
			expect(isPremiumServiceTier(tier)).toBe(false);
		}
	});
});

describe("providerKeyBaseUrlSupportsServiceTier", () => {
	it("ignores trailing slashes when matching the canonical upstream", () => {
		expect(
			providerKeyBaseUrlSupportsServiceTier(
				"google-vertex",
				"https://aiplatform.googleapis.com///",
			),
		).toBe(true);
	});

	it("allows a key with no custom base URL (managed default)", () => {
		expect(providerKeyBaseUrlSupportsServiceTier("google-vertex", null)).toBe(
			true,
		);
		expect(
			providerKeyBaseUrlSupportsServiceTier("google-ai-studio", undefined),
		).toBe(true);
	});

	it("allows a key whose base URL matches the canonical upstream", () => {
		expect(
			providerKeyBaseUrlSupportsServiceTier(
				"google-vertex",
				"https://aiplatform.googleapis.com",
			),
		).toBe(true);
		expect(
			providerKeyBaseUrlSupportsServiceTier(
				"google-ai-studio",
				"https://generativelanguage.googleapis.com/",
			),
		).toBe(true);
	});

	it("rejects a custom (proxy) base URL on the google tier providers", () => {
		expect(
			providerKeyBaseUrlSupportsServiceTier(
				"google-vertex",
				"https://my-proxy.example.com",
			),
		).toBe(false);
		expect(
			providerKeyBaseUrlSupportsServiceTier(
				"google-ai-studio",
				"https://gateway.internal/v1",
			),
		).toBe(false);
	});

	it("ignores providers without an upstream-only rule", () => {
		expect(
			providerKeyBaseUrlSupportsServiceTier(
				"openai",
				"https://my-proxy.example.com",
			),
		).toBe(true);
	});
});
