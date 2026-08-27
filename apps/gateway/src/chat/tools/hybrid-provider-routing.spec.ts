import { afterEach, describe, expect, it } from "vitest";

import {
	getAvailableProvidersForProjectMode,
	getRoutingCandidatesForProjectMode,
	platformCredentialCoversRegion,
	preferProvidersWithKeys,
} from "./hybrid-provider-routing.js";

import type { ManagedProviderAvailability } from "@/lib/cached-queries.js";
import type { ProviderModelMapping } from "@llmgateway/models";

function managedAvailability(values: {
	configured?: string[];
	usable?: string[];
	defaultRegionUsable?: string[];
	pinnedRegions?: Record<string, string[]>;
}): ManagedProviderAvailability {
	return {
		configured: new Set(values.configured ?? []),
		usable: new Set(values.usable ?? []),
		defaultRegionUsable: new Set(values.defaultRegionUsable ?? []),
		pinnedRegions: new Map(
			Object.entries(values.pinnedRegions ?? {}).map(([provider, regions]) => [
				provider,
				new Set(regions),
			]),
		),
	};
}

describe("hybrid-provider-routing", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	const originalGoogleVertexKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;
	const originalAlibabaKey = process.env.LLM_ALIBABA_API_KEY;

	afterEach(() => {
		if (originalAlibabaKey === undefined) {
			delete process.env.LLM_ALIBABA_API_KEY;
		} else {
			process.env.LLM_ALIBABA_API_KEY = originalAlibabaKey;
		}

		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
		}

		if (originalGoogleVertexKey === undefined) {
			delete process.env.LLM_GOOGLE_VERTEX_API_KEY;
		} else {
			process.env.LLM_GOOGLE_VERTEX_API_KEY = originalGoogleVertexKey;
		}
	});

	it("returns only provider keys in api-keys mode", () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai";

		const result = getAvailableProvidersForProjectMode(
			"api-keys",
			[{ provider: "google-ai-studio" }, { provider: "alibaba" }],
			["google-ai-studio", "google-vertex", "alibaba"],
		);

		expect(result.availableProviders).toEqual(["google-ai-studio", "alibaba"]);
		expect([...result.providersWithKeys]).toEqual([
			"google-ai-studio",
			"alibaba",
		]);
	});

	it("treats a managed credential as backing the provider in credits mode", () => {
		delete process.env.LLM_GOOGLE_VERTEX_API_KEY;

		const withoutManaged = getAvailableProvidersForProjectMode(
			"credits",
			[],
			["google-vertex"],
		);
		expect(withoutManaged.availableProviders).toEqual([]);

		const withManaged = getAvailableProvidersForProjectMode(
			"credits",
			[],
			["google-vertex"],
			managedAvailability({
				configured: ["google-vertex"],
				usable: ["google-vertex"],
			}),
		);
		expect(withManaged.availableProviders).toEqual(["google-vertex"]);
	});

	/**
	 * Managed credentials replace the environment rather than sitting in front
	 * of it: a provider configured on the admin dashboard whose credentials
	 * cannot serve this request must not silently fall back to the env key the
	 * operator already superseded.
	 */
	it("drops a configured provider whose managed credentials cannot serve the request", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-env-key";

		const result = getAvailableProvidersForProjectMode(
			"credits",
			[],
			["google-vertex"],
			// e.g. every credential is region-pinned, or restricted to other models.
			managedAvailability({ configured: ["google-vertex"], usable: [] }),
		);

		expect(result.availableProviders).toEqual([]);
	});

	/**
	 * A provider with no global region (Alibaba) can only ever hold region-pinned
	 * credentials, and a region-less route is served from its default region — so
	 * a credential pinned there backs the provider. It still covers no other
	 * region: those stay gated behind their own pinned credential.
	 */
	it("backs a provider whose credential is pinned to its default region", () => {
		const managed = managedAvailability({
			configured: ["alibaba"],
			usable: [],
			defaultRegionUsable: ["alibaba"],
			pinnedRegions: { alibaba: ["singapore", "eu-frankfurt"] },
		});

		const result = getAvailableProvidersForProjectMode(
			"credits",
			[],
			["alibaba"],
			managed,
		);

		expect(result.availableProviders).toEqual(["alibaba"]);
		expect(
			platformCredentialCoversRegion(
				"alibaba",
				"eu-frankfurt",
				managed,
				() => false,
			),
		).toBe(true);
		expect(
			platformCredentialCoversRegion(
				"alibaba",
				"cn-beijing",
				managed,
				() => true,
			),
		).toBe(false);
	});

	it("keeps reading the environment for providers with no managed credential", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-env-key";
		process.env.LLM_OPENAI_API_KEY = "sk-openai";

		const result = getAvailableProvidersForProjectMode(
			"credits",
			[],
			["google-vertex", "openai"],
			managedAvailability({ configured: ["openai"], usable: ["openai"] }),
		);

		expect(result.availableProviders).toEqual(["openai", "google-vertex"]);
	});

	it("reports region coverage from managed credentials only, once configured", () => {
		process.env.LLM_ALIBABA_API_KEY = "alibaba-env-key";
		const managed = managedAvailability({
			configured: ["alibaba"],
			usable: [],
			pinnedRegions: { alibaba: ["us-virginia"] },
		});

		expect(
			platformCredentialCoversRegion("alibaba", "us-virginia", managed, () => {
				throw new Error("env must not be consulted for a configured provider");
			}),
		).toBe(true);
		expect(
			platformCredentialCoversRegion(
				"alibaba",
				"cn-beijing",
				managed,
				() => true,
			),
		).toBe(false);
		// A provider with no managed credential still decides by its env vars.
		expect(
			platformCredentialCoversRegion(
				"openai",
				"us-virginia",
				managed,
				() => true,
			),
		).toBe(true);
	});

	it("prefers keyed providers over credits-backed providers in hybrid mode", () => {
		process.env.LLM_GOOGLE_VERTEX_API_KEY = "vertex-env-key";

		const result = getAvailableProvidersForProjectMode(
			"hybrid",
			[{ provider: "google-ai-studio" }],
			["google-ai-studio", "google-vertex"],
		);

		expect(result.availableProviders).toEqual([
			"google-ai-studio",
			"google-vertex",
		]);

		const candidates: ProviderModelMapping[] = [
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
		];

		expect(
			preferProvidersWithKeys("hybrid", candidates, result.providersWithKeys),
		).toMatchObject([
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
			},
		]);
	});

	it("falls back to non-rate-limited credits providers when every keyed candidate is rate limited", () => {
		const candidates: ProviderModelMapping[] = [
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
		];

		expect(
			getRoutingCandidatesForProjectMode(
				"hybrid",
				candidates,
				new Set(["google-ai-studio"]),
				new Set(["google-ai-studio"]),
			),
		).toMatchObject([
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
			},
		]);
	});

	it("keeps keyed candidates if every provider is rate limited", () => {
		const candidates: ProviderModelMapping[] = [
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
			{
				providerId: "google-vertex",
				externalId: "gemini-2.5-flash-lite",
				streaming: true,
			},
		];

		expect(
			getRoutingCandidatesForProjectMode(
				"hybrid",
				candidates,
				new Set(["google-ai-studio", "google-vertex"]),
				new Set(["google-ai-studio"]),
			),
		).toMatchObject([
			{
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-lite",
			},
		]);
	});
});
