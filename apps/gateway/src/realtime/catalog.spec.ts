import { describe, expect, it } from "vitest";

import {
	findDefaultRealtimeTranscriptionMapping,
	findRealtimeMapping,
	findRealtimeTranscriptionMapping,
	findTranscriptionSessionMapping,
	listRealtimeTranscriptionMappings,
} from "./catalog.js";

describe("findRealtimeMapping", () => {
	it("resolves gpt-realtime to the OpenAI realtime mapping", () => {
		const match = findRealtimeMapping("gpt-realtime");
		expect(match).not.toBeNull();
		expect(match?.modelId).toBe("gpt-realtime");
		expect(match?.mapping.providerId).toBe("openai");
		expect(match?.mapping.realtime).toBe(true);
	});

	it("resolves the dated snapshot alias", () => {
		const match = findRealtimeMapping("gpt-realtime-2025-08-28");
		expect(match?.modelId).toBe("gpt-realtime");
	});

	it("resolves provider-pinned model strings", () => {
		const match = findRealtimeMapping("openai/gpt-realtime-mini");
		expect(match?.modelId).toBe("gpt-realtime-mini");
		expect(match?.mapping.providerId).toBe("openai");
	});

	it("returns null for unknown providers", () => {
		expect(findRealtimeMapping("anthropic/gpt-realtime")).toBeNull();
	});

	it("resolves the Gemini Live model to its google-ai-studio mapping", () => {
		const match = findRealtimeMapping(
			"gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(match?.modelId).toBe(
			"gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(match?.mapping.providerId).toBe("google-ai-studio");
		expect(match?.mapping.realtime).toBe(true);
	});

	it("resolves the provider-pinned Gemini Live model string", () => {
		const match = findRealtimeMapping(
			"google-ai-studio/gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(match?.mapping.providerId).toBe("google-ai-studio");
	});

	it("returns null for chat models without realtime support", () => {
		expect(findRealtimeMapping("gpt-4o-mini")).toBeNull();
	});

	it("returns null for transcription-only models", () => {
		expect(findRealtimeMapping("gpt-live-transcribe")).toBeNull();
	});

	it("returns null for unknown models", () => {
		expect(findRealtimeMapping("not-a-model")).toBeNull();
	});
});

describe("findRealtimeTranscriptionMapping", () => {
	it("resolves the canonical gateway id on the matching provider", () => {
		const match = findRealtimeTranscriptionMapping(
			"gpt-4o-mini-transcribe",
			"openai",
		);
		expect(match?.modelId).toBe("gpt-4o-mini-transcribe");
		expect(match?.mapping.providerId).toBe("openai");
		expect(match?.mapping.realtimeTranscription).toBe(true);
	});

	it("resolves the provider-pinned form", () => {
		const match = findRealtimeTranscriptionMapping(
			"openai/gpt-4o-transcribe",
			"openai",
		);
		expect(match?.modelId).toBe("gpt-4o-transcribe");
	});

	it("rejects a provider-pinned form for a different provider", () => {
		expect(
			findRealtimeTranscriptionMapping("openai/gpt-4o-transcribe", "azure"),
		).toBeNull();
	});

	it("rejects models on a different provider than the realtime session", () => {
		expect(
			findRealtimeTranscriptionMapping("gpt-4o-mini-transcribe", "anthropic"),
		).toBeNull();
	});

	it("rejects models without the realtimeTranscription capability", () => {
		expect(
			findRealtimeTranscriptionMapping("gpt-4o-mini", "openai"),
		).toBeNull();
		expect(findRealtimeTranscriptionMapping("whisper-1", "openai")).toBeNull();
	});
});

describe("findTranscriptionSessionMapping", () => {
	it("resolves a transcription model without a provider prefix", () => {
		const match = findTranscriptionSessionMapping("gpt-live-transcribe");
		expect(match?.modelId).toBe("gpt-live-transcribe");
		expect(match?.mapping.providerId).toBe("openai");
		expect(match?.mapping.realtimeTranscription).toBe(true);
	});

	it("resolves the provider-pinned form", () => {
		const match = findTranscriptionSessionMapping("openai/gpt-4o-transcribe");
		expect(match?.modelId).toBe("gpt-4o-transcribe");
	});

	it("rejects a provider without the mapping", () => {
		expect(
			findTranscriptionSessionMapping("anthropic/gpt-live-transcribe"),
		).toBeNull();
	});

	it("rejects realtime speech models and unknown models", () => {
		expect(findTranscriptionSessionMapping("gpt-realtime")).toBeNull();
		expect(findTranscriptionSessionMapping("not-a-model")).toBeNull();
	});
});

describe("findDefaultRealtimeTranscriptionMapping", () => {
	it("returns the first active ASR mapping for the provider", () => {
		const match = findDefaultRealtimeTranscriptionMapping("openai");
		expect(match?.modelId).toBe("gpt-4o-mini-transcribe");
	});

	it("returns null for providers without ASR mappings", () => {
		expect(findDefaultRealtimeTranscriptionMapping("anthropic")).toBeNull();
	});
});

describe("listRealtimeTranscriptionMappings", () => {
	it("lists every active ASR mapping for the provider", () => {
		const modelIds = listRealtimeTranscriptionMappings("openai").map(
			(match) => match.modelId,
		);
		expect(modelIds).toContain("gpt-4o-mini-transcribe");
		expect(modelIds).toContain("gpt-4o-transcribe");
		expect(
			listRealtimeTranscriptionMappings("openai").every(
				(match) => match.mapping.realtimeTranscription === true,
			),
		).toBe(true);
	});

	it("returns an empty list for providers without ASR mappings", () => {
		expect(listRealtimeTranscriptionMappings("anthropic")).toEqual([]);
	});
});
