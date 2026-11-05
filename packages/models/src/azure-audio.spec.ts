import { describe, expect, it } from "vitest";

import { models } from "./models.js";

import type { ModelDefinition, ProviderModelMapping } from "./models.js";

function capabilities(mapping: ProviderModelMapping) {
	return {
		audio: mapping.audio,
		vision: mapping.vision,
		tools: mapping.tools,
		realtime: mapping.realtime,
		realtimeTranscription: mapping.realtimeTranscription,
		realtimeTranscriptionTurnDetection:
			mapping.realtimeTranscriptionTurnDetection,
		speechGenerations: mapping.speechGenerations,
	};
}

const audioModels = (models as readonly ModelDefinition[]).filter((model) =>
	model.providers.some(
		(mapping) =>
			mapping.providerId === "openai" &&
			(mapping.realtime ||
				mapping.realtimeTranscription ||
				mapping.speechGenerations),
	),
);

describe("Azure audio capability coverage", () => {
	it.each(audioModels)("maps OpenAI audio capabilities for $id", (model) => {
		const openai = model.providers.find(
			(mapping) => mapping.providerId === "openai",
		)!;
		const azure = model.providers.find(
			(mapping) => mapping.providerId === "azure",
		);
		expect(azure).toBeDefined();
		expect(capabilities(azure!)).toEqual(capabilities(openai));
		if (model.id !== "tts-1" && model.id !== "tts-1-hd") {
			expect(azure!.supportedVoices).toEqual(openai.supportedVoices);
		}
	});

	it.each(
		audioModels.filter((model) =>
			model.providers.some(
				(mapping) => mapping.providerId === "openai" && mapping.realtime,
			),
		),
	)("prices realtime image input for $id", (model) => {
		for (const mapping of model.providers.filter(
			(provider) =>
				provider.providerId === "azure" || provider.providerId === "openai",
		)) {
			expect(mapping.vision).toBe(true);
			expect(mapping.imageInputPrice).toBeDefined();
			expect(mapping.cachedImageInputPrice).toBeDefined();
		}
	});

	it.each(["tts-1", "tts-1-hd"])(
		"advertises only the voices Azure accepts for %s",
		(id) => {
			const azure = audioModels
				.find((model) => model.id === id)!
				.providers.find((mapping) => mapping.providerId === "azure")!;
			expect(azure.supportedVoices).toEqual([
				"alloy",
				"echo",
				"fable",
				"nova",
				"onyx",
				"shimmer",
			]);
		},
	);
});
