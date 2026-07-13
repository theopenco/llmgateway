import { afterEach, describe, expect, it } from "vitest";

import {
	getAvailableProvidersForProjectMode,
	getRoutingCandidatesForProjectMode,
	preferProvidersWithKeys,
} from "./hybrid-provider-routing.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("hybrid-provider-routing", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	const originalGoogleVertexKey = process.env.LLM_GOOGLE_VERTEX_API_KEY;

	afterEach(() => {
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
