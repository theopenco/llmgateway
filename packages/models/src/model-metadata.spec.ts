import { describe, expect, it } from "vitest";

import { models } from "./models.js";

import type { ModelDefinition, ProviderModelMapping } from "./models.js";

// A model's non-text capabilities are signalled by per-mapping flags, but the
// gateway routes gate requests on the model-level `output` array. The two must
// agree: a model that serves a dedicated endpoint (embeddings, OCR, etc.) must
// declare the matching output, or chat completions (which defaults a missing
// `output` to ["text"]) would wrongly accept it. Image is intentionally allowed
// on chat completions, so image-gen models just need "image" present — they may
// also output text.
const REQUIRED_OUTPUT_BY_FLAG: {
	flag: keyof ProviderModelMapping;
	output: string;
}[] = [
	{ flag: "imageGenerations", output: "image" },
	{ flag: "embeddings", output: "embedding" },
	{ flag: "speechGenerations", output: "audio" },
	{ flag: "videoGenerations", output: "video" },
	{ flag: "ocr", output: "ocr" },
	{ flag: "transcriptions", output: "transcription" },
];

describe("model metadata", () => {
	it("uses Azure Foundry limits for Grok 4.3", () => {
		const grok43 = models.find((model) => model.id === "grok-4-3");
		const azure = grok43?.providers.find(
			(provider) => provider.providerId === "azure-ai-foundry",
		);

		expect(azure).toMatchObject({
			contextSize: 20_000,
			maxOutput: 8_192,
		});
	});

	it("sets releasedAt for every model", () => {
		const missing = models
			.filter((model) => !model.releasedAt)
			.map((model) => model.id);

		expect(missing).toEqual([]);
	});

	it("uses valid Date instances for releasedAt", () => {
		const invalid = models
			.filter(
				(model) =>
					model.releasedAt !== undefined &&
					(!(model.releasedAt instanceof Date) ||
						Number.isNaN(model.releasedAt.getTime())),
			)
			.map((model) => model.id);

		expect(invalid).toEqual([]);
	});

	it("declares matching output for every non-text capability flag", () => {
		const offenders: string[] = [];

		for (const model of models as readonly ModelDefinition[]) {
			const outputs: string[] = model.output ?? ["text"];

			for (const { flag, output } of REQUIRED_OUTPUT_BY_FLAG) {
				const hasFlag = model.providers.some(
					(provider) => (provider as ProviderModelMapping)[flag] === true,
				);

				if (hasFlag && !outputs.includes(output)) {
					offenders.push(
						`${model.id} (flag "${flag}" needs output "${output}")`,
					);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
