import { describe, expect, it } from "vitest";

import { models } from "./models.js";

import type { ModelDefinition, ProviderModelMapping } from "./models.js";

/**
 * Catalogue validation for realtime mappings: a realtime model is billed per
 * modality from the mapping's token prices, so every realtime mapping must
 * declare the prices and modalities the billing path depends on. A mapping
 * that passes silently without them would produce unpriceable sessions.
 */
describe("realtime model catalogue validation", () => {
	const realtimeEntries = (models as readonly ModelDefinition[]).flatMap(
		(model) =>
			model.providers
				.filter((p) => (p as ProviderModelMapping).realtime === true)
				.map((mapping) => ({
					model,
					mapping: mapping as ProviderModelMapping,
				})),
	);

	it("has at least one realtime mapping", () => {
		expect(realtimeEntries.length).toBeGreaterThan(0);
	});

	it.each(realtimeEntries.map((e) => [e.model.id, e] as const))(
		"%s declares required realtime prices and modalities",
		(_id, entry) => {
			const { model, mapping } = entry;
			// Text and audio prices, cached and uncached, must all be priceable.
			expect(mapping.inputPrice).toBeDefined();
			expect(mapping.cachedInputPrice).toBeDefined();
			expect(mapping.outputPrice).toBeDefined();
			expect(mapping.inputAudioPrice).toBeDefined();
			expect(mapping.cachedInputAudioPrice).toBeDefined();
			expect(mapping.outputAudioPrice).toBeDefined();
			// Realtime sessions produce text and audio output.
			expect(model.output).toContain("text");
			expect(model.output).toContain("audio");
			// Audio input capability must be declared for modality reporting.
			expect(mapping.audio).toBe(true);
			// Realtime models are excluded from the chat e2e harness.
			expect(mapping.test).toBe("skip");
			// The realtime voice catalogue differs from the TTS catalogue, so each
			// realtime mapping must declare its own voices (first entry = default).
			expect(mapping.supportedVoices?.length).toBeGreaterThan(0);
		},
	);

	it("declares the Gemini Live native-audio mapping exactly", () => {
		const entry = realtimeEntries.find(
			(e) => e.model.id === "gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(entry).toBeDefined();
		const { model, mapping } = entry!;
		expect(model.output).toEqual(["text", "audio"]);
		expect(model.stability).toBe("beta");
		expect(mapping.providerId).toBe("google-ai-studio");
		expect(mapping.externalId).toBe(
			"gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(mapping.contextSize).toBe(131072);
		expect(mapping.maxOutput).toBe(8192);
		expect(mapping.inputPrice).toBe("0.5e-6");
		expect(mapping.inputAudioPrice).toBe("3.0e-6");
		expect(mapping.outputPrice).toBe("2.0e-6");
		expect(mapping.outputAudioPrice).toBe("12.0e-6");
		expect(mapping.requestPrice).toBe("0");
		// Live has no context caching, so the cached placeholders bill at the
		// full rate rather than leaving the modality unpriceable.
		expect(mapping.cachedInputPrice).toBe(mapping.inputPrice);
		expect(mapping.cachedInputAudioPrice).toBe(mapping.inputAudioPrice);
		// Image input is rejected by the session, so it must stay unpriceable.
		expect(mapping.imageInputPrice).toBeUndefined();
		expect(mapping.cachedImageInputPrice).toBeUndefined();
		expect(mapping.tools).toBe(true);
		expect(mapping.streaming).toBe(false);
		expect(mapping.supportedVoices?.[0]).toBe("Kore");
		expect(mapping.supportedVoices).toHaveLength(30);
	});

	it("declares the Gemini 3.1 Flash Live mapping exactly", () => {
		const entry = realtimeEntries.find(
			(e) => e.model.id === "gemini-3.1-flash-live-preview",
		);
		expect(entry).toBeDefined();
		const { model, mapping } = entry!;
		expect(model.output).toEqual(["text", "audio"]);
		expect(mapping.providerId).toBe("google-ai-studio");
		expect(mapping.externalId).toBe("gemini-3.1-flash-live-preview");
		expect(mapping.contextSize).toBe(131072);
		expect(mapping.maxOutput).toBe(65536);
		// https://ai.google.dev/gemini-api/docs/pricing — $0.75 text in,
		// $3.00 audio in, $4.50 text out (thinking included), $12.00 audio out.
		expect(mapping.inputPrice).toBe("0.75e-6");
		expect(mapping.inputAudioPrice).toBe("3.0e-6");
		expect(mapping.outputPrice).toBe("4.5e-6");
		expect(mapping.outputAudioPrice).toBe("12.0e-6");
		expect(mapping.requestPrice).toBe("0");
		expect(mapping.cachedInputPrice).toBe(mapping.inputPrice);
		expect(mapping.cachedInputAudioPrice).toBe(mapping.inputAudioPrice);
		expect(mapping.imageInputPrice).toBeUndefined();
		expect(mapping.tools).toBe(true);
	});

	const transcriptionEntries = (models as readonly ModelDefinition[]).flatMap(
		(model) =>
			model.providers
				.filter(
					(p) => (p as ProviderModelMapping).realtimeTranscription === true,
				)
				.map((mapping) => ({
					model,
					mapping: mapping as ProviderModelMapping,
				})),
	);

	it("has at least one realtime transcription mapping", () => {
		expect(transcriptionEntries.length).toBeGreaterThan(0);
	});

	it.each(transcriptionEntries.map((e) => [e.model.id, e] as const))(
		"%s declares required transcription prices",
		(_id, entry) => {
			const { mapping } = entry;
			// Transcription usage is token-metered per modality: text input, audio
			// input, and text output must all be priceable, or completed
			// transcription events would be unbillable.
			expect(mapping.inputPrice).toBeDefined();
			expect(mapping.inputAudioPrice).toBeDefined();
			expect(mapping.outputPrice).toBeDefined();
			expect(mapping.audio).toBe(true);
			expect(mapping.test).toBe("skip");
		},
	);
});
