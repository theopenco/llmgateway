import { afterEach, describe, expect, it } from "vitest";

import { resolveUpstreamTarget } from "./connect-upstream.js";

import type { RealtimePreflightResult } from "./preflight.js";

function buildPreflight(
	providerId: string,
	externalId: string,
	configIndex = 0,
): RealtimePreflightResult {
	return {
		match: {
			modelId: externalId,
			modelDef: { id: externalId },
			mapping: { providerId, externalId },
		},
		upstreamToken: "upstream-secret",
		configIndex,
		safetyIdentifier: "safety-hash",
	} as unknown as RealtimePreflightResult;
}

afterEach(() => {
	delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
	delete process.env.LLM_OPENAI_BASE_URL;
});

describe("resolveUpstreamTarget", () => {
	it("builds the Gemini Live BidiGenerateContent URL", () => {
		const target = resolveUpstreamTarget(
			buildPreflight(
				"google-ai-studio",
				"gemini-2.5-flash-native-audio-preview-12-2025",
			),
		);
		expect(target.url).toBe(
			"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
		);
	});

	it("authenticates Gemini with x-goog-api-key only", () => {
		const target = resolveUpstreamTarget(
			buildPreflight(
				"google-ai-studio",
				"gemini-2.5-flash-native-audio-preview-12-2025",
			),
		);
		expect(target.headers).toEqual({ "x-goog-api-key": "upstream-secret" });
		// OpenAI-only headers must not leak onto the Google connection.
		expect(target.headers["OpenAI-Safety-Identifier"]).toBeUndefined();
		expect(target.headers.Authorization).toBeUndefined();
	});

	it("never places the Gemini credential in the URL", () => {
		const target = resolveUpstreamTarget(
			buildPreflight(
				"google-ai-studio",
				"gemini-2.5-flash-native-audio-preview-12-2025",
			),
		);
		expect(target.url).not.toContain("upstream-secret");
		expect(target.url).not.toContain("key=");
		expect(target.url).not.toContain("?");
	});

	it("honors the indexed Gemini base-URL override", () => {
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL =
			"https://primary.example.com,https://secondary.example.com";
		const target = resolveUpstreamTarget(
			buildPreflight(
				"google-ai-studio",
				"gemini-2.5-flash-native-audio-preview-12-2025",
				1,
			),
		);
		expect(target.url).toBe(
			"wss://secondary.example.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
		);
	});

	it("leaves the OpenAI URL and headers unchanged", () => {
		const target = resolveUpstreamTarget(
			buildPreflight("openai", "gpt-realtime-2.1-mini"),
		);
		expect(target.url).toBe(
			"wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini",
		);
		expect(target.headers).toEqual({
			Authorization: "Bearer upstream-secret",
			"OpenAI-Safety-Identifier": "safety-hash",
		});
	});
});
