import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

describe("speech", () => {
	const harness = createGatewayApiTestHarness();

	async function seedKeys(token: string, apiKeyId: string) {
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			token,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `provider-key-google-${apiKeyId}`,
			token: "google-test-key",
			provider: "google-ai-studio",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	test("/v1/audio/speech returns a WAV file", async () => {
		await seedKeys("real-token-speech-wav", "token-id-speech-wav");

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-wav",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
				voice: "Kore",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/wav");

		const bytes = Buffer.from(await res.arrayBuffer());
		// Minimal WAV header: "RIFF"...."WAVE"
		expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
		// 44-byte header + 16 bytes of mock PCM payload.
		expect(bytes.length).toBe(44 + 16);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "google-ai-studio/gemini-2.5-flash-preview-tts",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		expect(log?.promptTokens).toBe("5");
		expect(log?.completionTokens).toBe("42");
		// 42 audio output tokens * $10/1M.
		expect(Number(log?.outputCost)).toBeCloseTo(42 * 10e-6, 10);
	});

	test("/v1/audio/speech returns raw PCM when requested", async () => {
		await seedKeys("real-token-speech-pcm", "token-id-speech-pcm");

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-pcm",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
				response_format: "pcm",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/pcm");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.length).toBe(16);
	});

	test("/v1/audio/speech rejects unsupported response_format", async () => {
		await seedKeys("real-token-speech-mp3", "token-id-speech-mp3");

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-mp3",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
				response_format: "mp3",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Unsupported response_format");
	});

	test("/v1/audio/speech returns 400 for unknown model", async () => {
		await seedKeys("real-token-speech-unknown", "token-id-speech-unknown");

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-unknown",
			},
			body: JSON.stringify({
				model: "not-a-real-tts-model",
				input: "Hello there",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Speech generation model not found");
	});
});
