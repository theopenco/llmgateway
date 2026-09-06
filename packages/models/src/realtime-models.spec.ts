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
			// A completed transcription event is priced either per token (text
			// input, audio input, text output) or per audio duration; a mapping
			// declaring neither would produce unbillable events.
			const tokenPriced =
				mapping.inputPrice !== undefined &&
				mapping.inputAudioPrice !== undefined &&
				mapping.outputPrice !== undefined;
			const durationPriced = mapping.inputAudioHourPrice !== undefined;
			expect(tokenPriced || durationPriced).toBe(true);
			expect(mapping.audio).toBe(true);
			expect(mapping.test).toBe("skip");
		},
	);

	it("declares the gpt-live-transcribe mapping exactly", () => {
		const entry = transcriptionEntries.find(
			(e) => e.model.id === "gpt-live-transcribe",
		);
		expect(entry).toBeDefined();
		const { model, mapping } = entry!;
		expect(model.output).toEqual(["text"]);
		expect(mapping.providerId).toBe("openai");
		expect(mapping.externalId).toBe("gpt-live-transcribe");
		// $0.017 per minute of audio, expressed per hour.
		expect(mapping.inputAudioHourPrice).toBe("1.02");
		expect(mapping.requestPrice).toBe("0");
		// Duration-billed only: the token prices are the catalogue's zero
		// placeholders, which the billing path treats as absent so a token usage
		// block fails closed instead of billing nothing.
		expect(mapping.inputPrice).toBe("0");
		expect(mapping.outputPrice).toBe("0");
		expect(mapping.inputAudioPrice).toBeUndefined();
		expect(mapping.realtime).toBeUndefined();
		// Streaming ASR: OpenAI rejects turn_detection on this model.
		expect(mapping.realtimeTranscriptionTurnDetection).toBeUndefined();
	});

	it("declares the gpt-transcribe mapping exactly", () => {
		const entry = transcriptionEntries.find(
			(e) => e.model.id === "gpt-transcribe",
		);
		expect(entry).toBeDefined();
		const { model, mapping } = entry!;
		expect(model.output).toEqual(["text"]);
		expect(mapping.providerId).toBe("openai");
		expect(mapping.externalId).toBe("gpt-transcribe");
		// $0.0045 per minute of audio, expressed per hour.
		expect(mapping.inputAudioHourPrice).toBe("0.27");
		expect(mapping.requestPrice).toBe("0");
		expect(mapping.inputPrice).toBe("0");
		expect(mapping.outputPrice).toBe("0");
		expect(mapping.inputAudioPrice).toBeUndefined();
		expect(mapping.realtime).toBeUndefined();
		// Unlike the streaming model, gpt-transcribe transcribes committed turns
		// and accepts server VAD to commit them.
		expect(mapping.realtimeTranscriptionTurnDetection).toBe(true);
	});

	it("declares turn detection support only on transcription mappings", () => {
		for (const model of models as readonly ModelDefinition[]) {
			for (const provider of model.providers) {
				const mapping = provider as ProviderModelMapping;
				if (mapping.realtimeTranscriptionTurnDetection === undefined) {
					continue;
				}
				expect(mapping.realtimeTranscription).toBe(true);
			}
		}
	});
});
