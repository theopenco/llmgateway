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
		usedMode: "credits",
	} as unknown as RealtimePreflightResult;
}

afterEach(() => {
	delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
	delete process.env.LLM_OPENAI_BASE_URL;
	delete process.env.LLM_AZURE_RESOURCE;
	delete process.env.LLM_AZURE_BASE_URL;
});

describe("resolveUpstreamTarget", () => {
	it("builds the xAI realtime URL with bearer auth only", () => {
		const target = resolveUpstreamTarget(
			buildPreflight("xai", "grok-voice-3.0"),
		);
		expect(target.url).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-3.0");
		expect(target.headers).toEqual({
			Authorization: "Bearer upstream-secret",
		});
	});

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

	it("ignores the env base-URL override for a BYOK key", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://proxy.example.com/";
		const target = resolveUpstreamTarget({
			...buildPreflight("openai", "gpt-realtime-2.1-mini"),
			providerKey: { id: "byok-key", baseUrl: null },
		} as unknown as RealtimePreflightResult);
		expect(target.url).toBe(
			"wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini",
		);
	});

	it("strips a trailing slash from the configured base URL", () => {
		process.env.LLM_OPENAI_BASE_URL = "https://proxy.example.com/";
		const target = resolveUpstreamTarget(
			buildPreflight("openai", "gpt-realtime-2.1-mini"),
		);
		expect(target.url).toBe(
			"wss://proxy.example.com/v1/realtime?model=gpt-realtime-2.1-mini",
		);
	});

	it("connects transcription sessions with intent=transcription and no model", () => {
		const target = resolveUpstreamTarget({
			...buildPreflight("openai", "gpt-live-transcribe"),
			sessionType: "transcription",
		} as unknown as RealtimePreflightResult);
		expect(target.url).toBe(
			"wss://api.openai.com/v1/realtime?intent=transcription",
		);
		expect(target.headers.Authorization).toBe("Bearer upstream-secret");
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

	it("builds the Azure v1 realtime URL from the env resource with api-key auth", () => {
		process.env.LLM_AZURE_RESOURCE = "my-resource";
		const target = resolveUpstreamTarget(
			buildPreflight("azure", "gpt-realtime-2.1-mini"),
		);
		expect(target.url).toBe(
			"wss://my-resource.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2.1-mini",
		);
		expect(target.headers).toEqual({ "api-key": "upstream-secret" });
	});

	it("connects Azure transcription sessions with intent=transcription", () => {
		process.env.LLM_AZURE_RESOURCE = "my-resource";
		const target = resolveUpstreamTarget({
			...buildPreflight("azure", "gpt-live-transcribe"),
			sessionType: "transcription",
		} as unknown as RealtimePreflightResult);
		expect(target.url).toBe(
			"wss://my-resource.openai.azure.com/openai/v1/realtime?intent=transcription",
		);
	});

	it("uses an Azure BYOK key's own resource, not the env resource", () => {
		process.env.LLM_AZURE_RESOURCE = "platform-resource";
		const target = resolveUpstreamTarget({
			...buildPreflight("azure", "gpt-realtime-2.1"),
			providerKey: {
				id: "byok-key",
				baseUrl: null,
				options: { azure_resource: "org-resource" },
			},
		} as unknown as RealtimePreflightResult);
		expect(target.url).toBe(
			"wss://org-resource.openai.azure.com/openai/v1/realtime?model=gpt-realtime-2.1",
		);
	});

	it("rejects an Azure session without a resource or base URL", () => {
		expect(() =>
			resolveUpstreamTarget(buildPreflight("azure", "gpt-realtime-2.1")),
		).toThrow(/resource or a base URL/);
	});

	it("omits the safety identifier header when forwarding is off", () => {
		const target = resolveUpstreamTarget({
			...buildPreflight("openai", "gpt-realtime-2.1-mini"),
			safetyIdentifier: undefined,
		} as unknown as RealtimePreflightResult);
		expect(target.headers).toEqual({
			Authorization: "Bearer upstream-secret",
		});
	});
});

it("omits the gateway safety identifier on BYOK realtime sessions", () => {
	const preflight = buildPreflight("openai", "gpt-realtime-2.1-mini");
	preflight.usedMode = "api-keys";
	expect(
		resolveUpstreamTarget(preflight).headers["OpenAI-Safety-Identifier"],
	).toBeUndefined();
});
