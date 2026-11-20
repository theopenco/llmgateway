import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { extractVertexMusicAudio } from "@/speech/speech.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { getLastVertexMusicRequest } from "@/test-utils/mock-openai-server.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("music generation on /v1/audio/speech", () => {
	const harness = createGatewayApiTestHarness();

	async function seedVertexKey(
		token: string,
		tokenType: "api-key" | "oauth" = "api-key",
	) {
		await db.insert(tables.apiKey).values({
			id: `api-key-${token}`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		const providerKeyId = `provider-key-${token}`;
		await db.insert(tables.providerKey).values({
			id: providerKeyId,
			...encryptProviderKeyForStorage(
				"google-test-key",
				providerKeyId,
				"org-id",
			),
			provider: "google-vertex",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
			options: {
				google_vertex_project_id: "test-project",
				google_vertex_token_type: tokenType,
			},
		});
	}

	function createMusic(token: string, body: Record<string, unknown>) {
		return app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(body),
		});
	}

	test("lyria-002 calls :predict and returns the WAV clip", async () => {
		await seedVertexKey("music-lyria-2");

		const res = await createMusic("music-lyria-2", {
			model: "lyria-002",
			input: "A calm acoustic folk tune",
			negative_prompt: "drums",
			seed: 7,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/wav");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(bytes.length).toBe(44 + 16);

		const upstream = getLastVertexMusicRequest();
		expect(upstream?.path).toBe(
			"/v1/projects/test-project/locations/global/publishers/google/models/lyria-002:predict",
		);
		expect(upstream?.body).toEqual({
			instances: [
				{
					prompt: "A calm acoustic folk tune",
					negative_prompt: "drums",
					seed: 7,
				},
			],
			parameters: {},
		});

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "google-vertex/lyria-002");
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		// Flat price per generated clip.
		expect(Number(log?.requestCost)).toBeCloseTo(0.06, 10);
		expect(Number(log?.cost)).toBeCloseTo(0.06, 10);
		expect(log?.estimatedCost).toBe(false);
	});

	test("lyria-002 strips the WAV header for PCM", async () => {
		await seedVertexKey("music-lyria-2-pcm");

		const res = await createMusic("music-lyria-2-pcm", {
			model: "google-vertex/lyria-002",
			input: "A calm acoustic folk tune",
			response_format: "pcm",
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/pcm");
		expect(Buffer.from(await res.arrayBuffer()).length).toBe(16);
	});

	test("lyria-002 does not bill a prompt that returns no audio", async () => {
		await seedVertexKey("music-lyria-2-empty");

		const res = await createMusic("music-lyria-2-empty", {
			model: "lyria-002",
			input: "NO_AUDIO please",
		});

		expect(res.status).toBe(500);
		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "google-vertex/lyria-002");
		expect(log?.hasError).toBe(true);
		expect(Number(log?.cost)).toBe(0);
	});

	test("lyria-3-pro-preview calls the Interactions API and returns MP3", async () => {
		await seedVertexKey("music-lyria-3-pro", "oauth");

		const res = await createMusic("music-lyria-3-pro", {
			model: "lyria-3-pro-preview",
			input: "An upbeat synth pop song about the sea",
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
		expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(
			"ID3-mock-song",
		);

		const upstream = getLastVertexMusicRequest();
		expect(upstream?.path).toBe(
			"/v1/projects/test-project/locations/global/interactions",
		);
		expect(upstream?.authorization?.startsWith("Bearer ")).toBe(true);
		expect(upstream?.body).toEqual({
			model: "lyria-3-pro-preview",
			input: [
				{
					type: "user_input",
					content: [
						{ type: "text", text: "An upbeat synth pop song about the sea" },
					],
				},
			],
		});

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "google-vertex/lyria-3-pro-preview",
		);
		expect(log?.hasError).toBe(false);
		expect(Number(log?.cost)).toBeCloseTo(0.08, 10);
	});

	test("lyria-3-clip-preview bills its own clip price", async () => {
		await seedVertexKey("music-lyria-3-clip", "oauth");

		const res = await createMusic("music-lyria-3-clip", {
			model: "lyria-3-clip-preview",
			input: "A short lo-fi beat",
		});

		expect(res.status).toBe(200);
		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "google-vertex/lyria-3-clip-preview",
		);
		expect(Number(log?.cost)).toBeCloseTo(0.04, 10);
	});

	test("Lyria 3 rejects wav, negative_prompt and seed", async () => {
		await seedVertexKey("music-lyria-3-params", "oauth");

		const wav = await createMusic("music-lyria-3-params", {
			model: "lyria-3-clip-preview",
			input: "A short lo-fi beat",
			response_format: "wav",
		});
		expect(wav.status).toBe(400);
		expect((await wav.json()).error.code).toBe("unsupported_response_format");

		for (const extra of [{ negative_prompt: "drums" }, { seed: 1 }]) {
			const res = await createMusic("music-lyria-3-params", {
				model: "lyria-3-clip-preview",
				input: "A short lo-fi beat",
				...extra,
			});
			expect(res.status).toBe(400);
			expect((await res.json()).error.code).toBe("unsupported_parameter");
		}
	});

	test("speech models reject the music-only parameters", async () => {
		await seedVertexKey("music-tts-params");

		const res = await createMusic("music-tts-params", {
			model: "google-vertex/gemini-3.1-flash-tts-preview",
			input: "Hello there",
			seed: 1,
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("unsupported_parameter");
	});

	test("Lyria 3 refuses an API-key Vertex credential", async () => {
		await seedVertexKey("music-lyria-3-apikey");

		const res = await createMusic("music-lyria-3-apikey", {
			model: "lyria-3-clip-preview",
			input: "A short lo-fi beat",
		});
		expect(res.status).toBe(500);
		expect(await res.text()).toContain("OAuth");
	});
});

describe("extractVertexMusicAudio", () => {
	test("reads the first prediction of a :predict response", () => {
		expect(
			extractVertexMusicAudio("vertex-predict", {
				predictions: [
					{ audioContent: "AAAA", mimeType: "audio/wav" },
					{ audioContent: "BBBB", mimeType: "audio/wav" },
				],
			}),
		).toEqual({ data: "AAAA", mimeType: "audio/wav" });
	});

	test("finds the audio step of an interaction", () => {
		expect(
			extractVertexMusicAudio("vertex-interactions", {
				steps: [
					{ content: [{ type: "text", text: "Lyrics" }] },
					{
						content: [{ type: "audio", mime_type: "audio/mpeg", data: "CCCC" }],
					},
				],
			}),
		).toEqual({ data: "CCCC", mimeType: "audio/mpeg" });
	});

	test("returns undefined for errors and empty responses", () => {
		expect(extractVertexMusicAudio("vertex-predict", {})).toBeUndefined();
		expect(
			extractVertexMusicAudio("vertex-interactions", [
				{ error: { code: 401 } },
			]),
		).toBeUndefined();
		expect(extractVertexMusicAudio("vertex-predict", null)).toBeUndefined();
	});
});
