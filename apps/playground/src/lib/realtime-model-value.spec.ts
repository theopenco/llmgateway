import { describe, expect, it } from "vitest";

import {
	isKnownModelValue,
	parseModelValue,
	resolveSelectedMapping,
} from "./realtime-model-value";

import type { ApiModel } from "@/lib/fetch-models";

const models = [
	{
		id: "gemini-2.5-flash-native-audio-preview-12-2025",
		mappings: [{ providerId: "google-ai-studio", supportedVoices: ["Kore"] }],
	},
	{
		id: "gpt-realtime-2.1-mini",
		mappings: [{ providerId: "openai", supportedVoices: ["marin"] }],
	},
] as unknown as ApiModel[];

describe("parseModelValue", () => {
	it("treats a bare id as an auto selection", () => {
		expect(parseModelValue("gpt-realtime-2.1-mini")).toEqual({
			modelId: "gpt-realtime-2.1-mini",
			providerId: null,
		});
	});

	it("splits a provider-pinned value", () => {
		expect(
			parseModelValue(
				"google-ai-studio/gemini-2.5-flash-native-audio-preview-12-2025",
			),
		).toEqual({
			providerId: "google-ai-studio",
			modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
		});
	});

	it("strips a region suffix", () => {
		expect(parseModelValue("google-vertex/some-model:us-central1")).toEqual({
			providerId: "google-vertex",
			modelId: "some-model",
		});
	});
});

describe("resolveSelectedMapping", () => {
	it("resolves an auto selection to the first mapping", () => {
		expect(
			resolveSelectedMapping(models, "gpt-realtime-2.1-mini")?.providerId,
		).toBe("openai");
	});

	// Regression: a provider-pinned value used to miss the catalogue lookup
	// entirely, leaving the page with no mapping — so the call fell back to the
	// OpenAI wire protocol and a Gemini session hung at "Connecting…".
	it("resolves a provider-pinned Gemini selection to its own mapping", () => {
		const mapping = resolveSelectedMapping(
			models,
			"google-ai-studio/gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(mapping?.providerId).toBe("google-ai-studio");
		expect(mapping?.supportedVoices).toEqual(["Kore"]);
	});

	it("returns null when the pinned provider does not serve the model", () => {
		expect(
			resolveSelectedMapping(models, "openai/gpt-realtime-2.1-mini"),
		).not.toBeNull();
		expect(
			resolveSelectedMapping(
				models,
				"openai/gemini-2.5-flash-native-audio-preview-12-2025",
			),
		).toBeNull();
	});

	it("returns null for an unknown model", () => {
		expect(resolveSelectedMapping(models, "not-a-model")).toBeNull();
	});
});

describe("isKnownModelValue", () => {
	it("accepts both selector forms and rejects stale values", () => {
		expect(isKnownModelValue(models, "gpt-realtime-2.1-mini")).toBe(true);
		expect(
			isKnownModelValue(
				models,
				"google-ai-studio/gemini-2.5-flash-native-audio-preview-12-2025",
			),
		).toBe(true);
		expect(isKnownModelValue(models, "retired-model")).toBe(false);
		expect(isKnownModelValue(models, "anthropic/gpt-realtime-2.1-mini")).toBe(
			false,
		);
	});
});
