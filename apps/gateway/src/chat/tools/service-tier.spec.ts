import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, test } from "vitest";

import {
	assertServiceTierHonored,
	getForwardedServiceTier,
	mappingSupportsRequestedServiceTier,
	providerKeySupportsServiceTier,
} from "./service-tier.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

function providerKey(overrides: Partial<ProviderKeyRow>): ProviderKeyRow {
	return {
		id: "key-id",
		provider: "openai",
		baseUrl: null,
		options: null,
		config: null,
		region: null,
		...overrides,
	} as ProviderKeyRow;
}

describe("getForwardedServiceTier", () => {
	test("forwards a tier the mapping supports", () => {
		expect(
			getForwardedServiceTier("gpt-5.5", "openai", undefined, "flex"),
		).toBe("flex");
	});

	test("drops a tier the mapping does not support", () => {
		expect(
			getForwardedServiceTier("gpt-5.6-sol", "aws-mantle", undefined, "flex"),
		).toBeUndefined();
	});

	test("is undefined for non-premium tiers", () => {
		expect(
			getForwardedServiceTier("gpt-5.5", "openai", undefined, "auto"),
		).toBeUndefined();
		expect(
			getForwardedServiceTier("gpt-5.5", "openai", undefined, undefined),
		).toBeUndefined();
	});

	describe("google-vertex region resolution", () => {
		const originalRegion = process.env.LLM_GOOGLE_VERTEX_REGION;

		afterEach(() => {
			if (originalRegion === undefined) {
				delete process.env.LLM_GOOGLE_VERTEX_REGION;
			} else {
				process.env.LLM_GOOGLE_VERTEX_REGION = originalRegion;
			}
		});

		test("reads the credential's region when the mapping has none", () => {
			process.env.LLM_GOOGLE_VERTEX_REGION = "us-central1";
			expect(
				getForwardedServiceTier(
					"gemini-3.5-flash",
					"google-vertex",
					undefined,
					"priority",
				),
			).toBeUndefined();

			process.env.LLM_GOOGLE_VERTEX_REGION = "global";
			expect(
				getForwardedServiceTier(
					"gemini-3.5-flash",
					"google-vertex",
					undefined,
					"priority",
				),
			).toBe("priority");
		});
	});
});

describe("mappingSupportsRequestedServiceTier", () => {
	test("keeps mappings that declare the tier and drops the rest", () => {
		expect(
			mappingSupportsRequestedServiceTier(
				"gpt-5.6-sol",
				{ providerId: "openai" },
				"flex",
			),
		).toBe(true);
		expect(
			mappingSupportsRequestedServiceTier(
				"gpt-5.6-sol",
				{ providerId: "aws-mantle" },
				"flex",
			),
		).toBe(false);
	});
});

describe("providerKeySupportsServiceTier", () => {
	test("accepts a key on the provider's own upstream", () => {
		expect(providerKeySupportsServiceTier(providerKey({}))).toBe(true);
	});

	test("rejects a proxied key for upstream-only tier providers", () => {
		expect(
			providerKeySupportsServiceTier(
				providerKey({
					provider: "google-ai-studio",
					baseUrl: "https://proxy.example.com",
				}),
			),
		).toBe(false);
	});

	test("rejects a Vertex credential pinned to a regional endpoint", () => {
		expect(
			providerKeySupportsServiceTier(
				providerKey({
					provider: "google-vertex",
					config: { region: "us-central1" },
				}),
			),
		).toBe(false);
		expect(
			providerKeySupportsServiceTier(
				providerKey({
					provider: "google-vertex",
					options: { env_config: { region: "europe-west4" } },
				}),
			),
		).toBe(false);
		expect(
			providerKeySupportsServiceTier(
				providerKey({ provider: "google-vertex", region: "us-east1" }),
			),
		).toBe(false);
	});

	test("accepts a Vertex credential on the global endpoint", () => {
		expect(
			providerKeySupportsServiceTier(
				providerKey({
					provider: "google-vertex",
					config: { region: "global" },
				}),
			),
		).toBe(true);
		expect(
			providerKeySupportsServiceTier(
				providerKey({ provider: "google-vertex" }),
			),
		).toBe(true);
	});
});

describe("assertServiceTierHonored", () => {
	const base = {
		provider: "openai",
		model: "gpt-5.6-sol",
		region: undefined,
	};

	test("throws when an explicitly requested tier cannot be forwarded", () => {
		let thrown: unknown;
		try {
			assertServiceTierHonored({
				...base,
				clientRequestedServiceTier: "flex",
				forwardedServiceTier: undefined,
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(HTTPException);
		expect((thrown as HTTPException).status).toBe(400);
		expect((thrown as HTTPException).message).toContain(
			"Service tier 'flex' is not available for openai/gpt-5.6-sol",
		);
	});

	test("passes when the requested tier is forwarded", () => {
		expect(() =>
			assertServiceTierHonored({
				...base,
				clientRequestedServiceTier: "flex",
				forwardedServiceTier: "flex",
			}),
		).not.toThrow();
	});

	test("stays soft for an org-default tier the client did not request", () => {
		expect(() =>
			assertServiceTierHonored({
				...base,
				clientRequestedServiceTier: null,
				forwardedServiceTier: undefined,
			}),
		).not.toThrow();
	});
});
