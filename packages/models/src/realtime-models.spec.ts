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
