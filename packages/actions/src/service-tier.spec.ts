import { describe, expect, test } from "vitest";

import {
	getSupportedServiceTiers,
	mappingSupportsServiceTier,
	resolveOpenAIServedServiceTier,
} from "./service-tier.js";

import type { ServiceTierId } from "@llmgateway/models";

describe("service tier support", () => {
	test("accepts OpenAI mapping-specific service tiers", () => {
		const mapping = {
			providerId: "openai",
			externalId: "gpt-5.5",
			streaming: true,
			supportedServiceTiers: ["flex", "priority", "scale"] as ServiceTierId[],
		} as const;

		expect(mappingSupportsServiceTier(mapping, "priority")).toBe(true);
		expect(mappingSupportsServiceTier(mapping, "scale")).toBe(true);
		expect(mappingSupportsServiceTier(mapping, "auto")).toBe(true);
		expect(getSupportedServiceTiers(mapping)).toEqual([
			"auto",
			"default",
			"flex",
			"priority",
			"scale",
		]);
	});

	test("rejects unsupported non-standard tiers for OpenAI mappings", () => {
		const mapping = {
			providerId: "openai",
			externalId: "gpt-5.4-pro",
			streaming: true,
			supportedServiceTiers: ["flex", "scale"] as ServiceTierId[],
		} as const;

		expect(mappingSupportsServiceTier(mapping, "priority")).toBe(false);
		expect(mappingSupportsServiceTier(mapping, "flex")).toBe(true);
	});

	test("rejects service tiers for providers without tier support", () => {
		const mapping = {
			providerId: "anthropic",
			externalId: "claude-sonnet-4-6",
			streaming: true,
		} as const;

		expect(mappingSupportsServiceTier(mapping, "default")).toBe(false);
		expect(mappingSupportsServiceTier(mapping, "priority")).toBe(false);
		expect(getSupportedServiceTiers(mapping)).toEqual([]);
	});

	test("accepts provider-level Google Vertex service tiers", () => {
		const mapping = {
			providerId: "google-vertex",
			externalId: "gemini-2.5-pro",
			streaming: true,
		} as const;

		expect(mappingSupportsServiceTier(mapping, "default")).toBe(true);
		expect(mappingSupportsServiceTier(mapping, "priority")).toBe(true);
		expect(mappingSupportsServiceTier(mapping, "scale")).toBe(false);
	});

	test("resolves OpenAI served service_tier values", () => {
		expect(resolveOpenAIServedServiceTier({ service_tier: "priority" })).toBe(
			"priority",
		);
		expect(
			resolveOpenAIServedServiceTier({ service_tier: "unsupported" }),
		).toBe(null);
		expect(resolveOpenAIServedServiceTier({})).toBe(null);
	});
});
