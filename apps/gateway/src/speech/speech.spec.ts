import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { db, eq, tables } from "@llmgateway/db";

describe("speech", () => {
	const harness = createGatewayApiTestHarness();

	async function seedKeys(
		token: string,
		apiKeyId: string,
		provider:
			| "google-ai-studio"
			| "google-vertex"
			| "openai"
			| "elevenlabs"
			| "alibaba" = "google-ai-studio",
	) {
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			token,
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		const providerToken =
			provider === "openai"
				? "openai-test-key"
				: provider === "elevenlabs"
					? "elevenlabs-test-key"
					: provider === "alibaba"
						? "alibaba-test-key"
						: "google-test-key";
		await db.insert(tables.providerKey).values({
			id: `provider-key-${provider}-${apiKeyId}`,
			token: providerToken,
			provider,
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
			...(provider === "google-vertex"
				? { options: { google_vertex_project_id: "test-project" } }
				: {}),
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

	test("/v1/audio/speech rejects unsupported voice with 400", async () => {
		await seedKeys("real-token-speech-voice", "token-id-speech-voice");

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-voice",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
				voice: "not-a-real-voice",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Unsupported voice");
	});

	test("/v1/audio/speech rejects coding-plan personal orgs with 403", async () => {
		await seedKeys("real-token-speech-coding", "token-id-speech-coding");
		await harness.setDevPlan({ devPlan: "pro" });

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-coding",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
			}),
		});

		expect(res.status).toBe(403);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"Speech generation is not available for coding plans",
		);
	});

	test("/v1/audio/speech credits mode requires credits", async () => {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("0");
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await db.insert(tables.apiKey).values({
			id: "token-id-speech-no-credits",
			token: "real-token-speech-no-credits",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-no-credits",
			},
			body: JSON.stringify({
				model: "gemini-2.5-flash-preview-tts",
				input: "Hello there",
			}),
		});

		expect(res.status).toBe(402);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("has insufficient credits");
	});

	test("/v1/audio/speech accepts chat plan credits in credits mode", async () => {
		const originalApiKey = process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
		const originalBaseUrl = process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
		process.env.LLM_GOOGLE_AI_STUDIO_API_KEY = "google-env-key";
		process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL = harness.mockServerUrl;
		try {
			await harness.setProjectMode("credits");
			await harness.setOrganizationCredits("0");
			await db
				.update(tables.organization)
				.set({
					retentionLevel: "none",
					chatPlan: "starter",
					chatPlanCreditsLimit: "18",
					chatPlanCreditsUsed: "0.65",
				})
				.where(eq(tables.organization.id, "org-id"));

			await db.insert(tables.apiKey).values({
				id: "token-id-speech-chat-plan",
				token: "real-token-speech-chat-plan",
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			});

			const res = await app.request("/v1/audio/speech", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token-speech-chat-plan",
					"x-source": "chat.llmgateway.io",
				},
				body: JSON.stringify({
					model: "gemini-2.5-flash-preview-tts",
					input: "Hello there",
					voice: "Kore",
				}),
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("audio/wav");
		} finally {
			if (originalApiKey !== undefined) {
				process.env.LLM_GOOGLE_AI_STUDIO_API_KEY = originalApiKey;
			} else {
				delete process.env.LLM_GOOGLE_AI_STUDIO_API_KEY;
			}
			if (originalBaseUrl !== undefined) {
				process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL = originalBaseUrl;
			} else {
				delete process.env.LLM_GOOGLE_AI_STUDIO_BASE_URL;
			}
		}
	});

	test("/v1/audio/speech returns a WAV file via Google Vertex", async () => {
		await seedKeys(
			"real-token-speech-vertex",
			"token-id-speech-vertex",
			"google-vertex",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-vertex",
			},
			body: JSON.stringify({
				model: "google-vertex/gemini-2.5-pro-preview-tts",
				input: "Hello there",
				voice: "Kore",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/wav");

		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
		expect(bytes.length).toBe(44 + 16);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "google-vertex/gemini-2.5-pro-preview-tts",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		expect(log?.usedModelMapping).toBe("gemini-2.5-pro-tts");
		expect(log?.promptTokens).toBe("5");
		expect(log?.completionTokens).toBe("42");
		// 42 audio output tokens * $20/1M.
		expect(Number(log?.outputCost)).toBeCloseTo(42 * 20e-6, 10);
	});

	test("/v1/audio/speech serves gemini-3.1-flash-tts-preview via Vertex", async () => {
		await seedKeys(
			"real-token-speech-vertex-31",
			"token-id-speech-vertex-31",
			"google-vertex",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-vertex-31",
			},
			body: JSON.stringify({
				model: "google-vertex/gemini-3.1-flash-tts-preview",
				input: "Hello there",
				response_format: "pcm",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/pcm");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.length).toBe(16);

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "google-vertex/gemini-3.1-flash-tts-preview",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
	});

	test("/v1/audio/speech proxies OpenAI tts-1 and bills by characters", async () => {
		await seedKeys(
			"real-token-speech-openai",
			"token-id-speech-openai",
			"openai",
		);

		const input = "Hello from OpenAI";
		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-openai",
			},
			body: JSON.stringify({
				model: "tts-1",
				input,
				voice: "alloy",
			}),
		});

		expect(res.status).toBe(200);
		// Default OpenAI format is mp3.
		expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.toString("ascii")).toBe("MOCK_OPENAI_AUDIO");

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "openai/tts-1");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		// tts-1 bills $15 / 1M input characters.
		expect(Number(log?.inputCost)).toBeCloseTo(input.length * 15e-6, 12);
	});

	test("/v1/audio/speech proxies ElevenLabs and bills by characters", async () => {
		await seedKeys(
			"real-token-speech-eleven",
			"token-id-speech-eleven",
			"elevenlabs",
		);

		const input = "Hello from ElevenLabs";
		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-eleven",
			},
			body: JSON.stringify({
				model: "eleven-multilingual-v2",
				input,
				voice: "Sarah",
			}),
		});

		expect(res.status).toBe(200);
		// Default ElevenLabs format is mp3.
		expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.toString("ascii")).toBe("MOCK_ELEVENLABS_AUDIO");

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "elevenlabs/eleven-multilingual-v2",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		// eleven-multilingual-v2 bills $110 / 1M input characters.
		expect(Number(log?.inputCost)).toBeCloseTo(input.length * 110e-6, 12);
	});

	test("/v1/audio/speech proxies Qwen TTS via DashScope and bills by characters", async () => {
		await seedKeys("real-token-speech-qwen", "token-id-speech-qwen", "alibaba");

		const input = "Hello from Qwen TTS";
		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-qwen",
			},
			body: JSON.stringify({
				model: "qwen-audio-3.0-tts-plus",
				input,
				voice: "longanlingxin",
			}),
		});

		expect(res.status).toBe(200);
		// DashScope emits a WAV file URL which the gateway downloads and returns.
		expect(res.headers.get("Content-Type")).toBe("audio/wav");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.toString("ascii")).toBe("MOCK_DASHSCOPE_AUDIO");

		const logs = await waitForLogs(1);
		const log = logs.find(
			(l) => l.usedModel === "alibaba/qwen-audio-3.0-tts-plus",
		);
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		// qwen-audio-3.0-tts-plus bills $20.00 / 1M input characters.
		expect(Number(log?.inputCost)).toBeCloseTo(input.length * 20e-6, 12);
	});

	test("/v1/audio/speech rejects unsupported Qwen TTS response_format", async () => {
		await seedKeys(
			"real-token-speech-qwen-mp3",
			"token-id-speech-qwen-mp3",
			"alibaba",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-qwen-mp3",
			},
			body: JSON.stringify({
				model: "qwen-audio-3.0-tts-flash",
				input: "Hello there",
				response_format: "mp3",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Unsupported response_format");
	});

	test("/v1/audio/speech rejects unsupported Qwen TTS voice", async () => {
		await seedKeys(
			"real-token-speech-qwen-voice",
			"token-id-speech-qwen-voice",
			"alibaba",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-qwen-voice",
			},
			body: JSON.stringify({
				model: "qwen-audio-3.0-tts-plus",
				input: "Hello there",
				voice: "NotARealVoice",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Unsupported voice");
	});

	test("/v1/audio/speech returns a WAV file from ElevenLabs", async () => {
		await seedKeys(
			"real-token-speech-eleven-wav",
			"token-id-speech-eleven-wav",
			"elevenlabs",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-eleven-wav",
			},
			body: JSON.stringify({
				model: "eleven-flash-v2-5",
				input: "Hello there",
				response_format: "wav",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/wav");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.toString("ascii")).toBe("MOCK_ELEVENLABS_AUDIO");
	});

	test("/v1/audio/speech rejects unsupported ElevenLabs response_format", async () => {
		await seedKeys(
			"real-token-speech-eleven-aac",
			"token-id-speech-eleven-aac",
			"elevenlabs",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-eleven-aac",
			},
			body: JSON.stringify({
				model: "eleven-multilingual-v2",
				input: "Hello there",
				response_format: "aac",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("Unsupported response_format");
	});

	test("/v1/audio/speech bills gpt-4o-mini-tts on SSE token usage", async () => {
		await seedKeys(
			"real-token-speech-openai-wav",
			"token-id-speech-openai-wav",
			"openai",
		);

		const res = await app.request("/v1/audio/speech", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-speech-openai-wav",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini-tts",
				input: "Hello there",
				response_format: "wav",
				instructions: "Say it warmly",
			}),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/wav");
		// The SSE audio deltas are reassembled into the full payload.
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.toString("ascii")).toBe("MOCK_OPENAI_AUDIO");

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "openai/gpt-4o-mini-tts");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		// Usage comes from the speech.audio.done event (input 7, output 42).
		expect(log?.promptTokens).toBe("7");
		expect(log?.completionTokens).toBe("42");
		// $0.60/1M input text tokens + $12/1M output audio tokens.
		expect(Number(log?.inputCost)).toBeCloseTo(7 * 0.6e-6, 12);
		expect(Number(log?.outputCost)).toBeCloseTo(42 * 12e-6, 12);
	});
});
