import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import { buildMusicRequestBody, extractMusicAudio } from "./music.js";

describe("Lyria music", () => {
	it("builds the Vertex predict and Interactions request bodies", () => {
		expect(buildMusicRequestBody(true, "lyria-002", "calm piano")).toEqual({
			instances: [{ prompt: "calm piano" }],
			parameters: { sample_count: 1 },
		});
		expect(
			buildMusicRequestBody(false, "lyria-3-clip-preview", "calm piano"),
		).toEqual({ model: "lyria-3-clip-preview", input: "calm piano" });
	});

	it("extracts WAV audio from a Vertex predict response", () => {
		expect(
			extractMusicAudio({ predictions: [{ bytesBase64Encoded: "UklGRg==" }] }),
		).toEqual({
			data: "UklGRg==",
			mimeType: "audio/wav",
			inputTokens: null,
			outputTokens: null,
		});
	});

	it("accepts the documented audioContent prediction field", () => {
		expect(
			extractMusicAudio({ predictions: [{ audioContent: "UklGRg==" }] }).data,
		).toBe("UklGRg==");
	});

	it("extracts MP3 audio and usage from an Interactions response", () => {
		expect(
			extractMusicAudio({
				status: "completed",
				usage: { total_input_tokens: 10, total_output_tokens: 273 },
				steps: [
					{ type: "model_output", content: [{ type: "text", text: "lyrics" }] },
					{
						type: "model_output",
						content: [{ type: "audio", mime_type: "audio/mpeg", data: "SUQz" }],
					},
				],
			}),
		).toEqual({
			data: "SUQz",
			mimeType: "audio/mpeg",
			inputTokens: 10,
			outputTokens: 273,
		});
	});

	it("returns no audio for an empty or malformed response", () => {
		expect(extractMusicAudio(null).data).toBeUndefined();
		expect(
			extractMusicAudio({
				predictions: [null, { bytesBase64Encoded: "UklGRg==" }],
			}).data,
		).toBe("UklGRg==");
		expect(
			extractMusicAudio({ steps: [{ content: [] }] }).data,
		).toBeUndefined();
	});

	it("bills Lyria mappings per track only", () => {
		const lyria = models.flatMap((model) =>
			model.providers
				.filter((mapping) => "musicGenerations" in mapping)
				.map((mapping) => ({ id: model.id, mapping })),
		);
		expect(lyria.map(({ id }) => id).sort()).toEqual([
			"lyria-002",
			"lyria-3-clip-preview",
			"lyria-3-pro-preview",
		]);
		for (const { mapping } of lyria) {
			expect(mapping).toMatchObject({
				speechGenerations: true,
				inputPrice: "0",
				outputPrice: "0",
			});
			expect(Number(mapping.requestPrice)).toBeGreaterThan(0);
		}
	});
});
