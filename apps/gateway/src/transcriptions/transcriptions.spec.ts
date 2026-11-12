import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import {
	buildTranscriptionForm,
	normalizeTranscriptionResponse,
} from "./providers.js";

describe("transcriptions", () => {
	const harness = createGatewayApiTestHarness();

	async function seedKeys(token: string, apiKeyId: string) {
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `provider-key-xai-${apiKeyId}`,
			...encryptProviderKeyForStorage(
				"xai-test-key",
				`provider-key-xai-${apiKeyId}`,
				"org-id",
			),
			provider: "xai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	async function seedElevenLabsKey(apiKeyId: string) {
		await db.insert(tables.providerKey).values({
			id: `provider-key-elevenlabs-${apiKeyId}`,
			...encryptProviderKeyForStorage(
				"elevenlabs-test-key",
				`provider-key-elevenlabs-${apiKeyId}`,
				"org-id",
			),
			provider: "elevenlabs",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	function buildForm(model: string, fileName = "audio.mp3"): FormData {
		const form = new FormData();
		form.append("model", model);
		form.append("language", "en");
		form.append(
			"file",
			new File([Buffer.from("MOCK_AUDIO_BYTES")], fileName, {
				type: "audio/mpeg",
			}),
		);
		return form;
	}

	test("/v1/audio/transcriptions transcribes audio and bills by duration", async () => {
		await seedKeys("real-token-stt", "token-id-stt");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt",
			},
			body: buildForm("grok-stt-1-0"),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.text).toBe("The balance is $167,983.15.");
		expect(json.duration).toBe(3.45);
		expect(Array.isArray(json.words)).toBe(true);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "xai/grok-stt-1-0");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.finishReason).toBe("stop");
		expect(log?.estimatedCost).toBe(false);
		// grok-stt-1.0 bills $0.10 per hour of input audio.
		expect(Number(log?.inputCost)).toBeCloseTo((3.45 / 3600) * 0.1, 10);
		expect(Number(log?.cost)).toBeCloseTo((3.45 / 3600) * 0.1, 10);
	});

	test("/v1/audio/transcriptions accepts a provider-pinned model id", async () => {
		await seedKeys("real-token-stt-pinned", "token-id-stt-pinned");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt-pinned",
			},
			body: buildForm("xai/grok-stt-1-0"),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.text).toBe("The balance is $167,983.15.");
	});

	test("/v1/audio/transcriptions maps ElevenLabs Scribe requests and responses", async () => {
		await seedKeys("real-token-scribe", "token-id-scribe");
		await seedElevenLabsKey("token-id-scribe");

		const form = buildForm("elevenlabs/scribe-v3");
		form.append("diarize", "true");
		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: { Authorization: "Bearer real-token-scribe" },
			body: form,
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.text).toBe("Hello world.");
		expect(json.language).toBe("eng");
		expect(json.duration).toBe(7.2);
		expect(json.words).toEqual([
			{ text: "Hello", start: 0.1, end: 0.5, speaker: 0 },
			{ text: "world.", start: 0.6, end: 1.2, speaker: 1 },
		]);
		expect(json.mock_received).toBeUndefined();

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "elevenlabs/scribe-v3");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.estimatedCost).toBe(false);
		// scribe_v3 bills $0.20 per hour of input audio.
		expect(Number(log?.cost)).toBeCloseTo((7.2 / 3600) * 0.2, 10);
	});

	test("buildTranscriptionForm maps options onto Scribe fields", () => {
		const form = buildTranscriptionForm("elevenlabs", "scribe_v3", {
			language: "en",
			diarize: true,
			fillerWords: false,
			keyterms: [],
			url: "https://example.com/a.mp3",
		});
		expect(Object.fromEntries(form.entries())).toEqual({
			model_id: "scribe_v3",
			language_code: "en",
			diarize: "true",
			no_verbatim: "true",
			source_url: "https://example.com/a.mp3",
		});
		const verbatim = buildTranscriptionForm("elevenlabs", "scribe_v3", {
			diarize: false,
			fillerWords: true,
			keyterms: [],
			url: "https://example.com/a.mp3",
		});
		expect(verbatim.has("no_verbatim")).toBe(false);
		expect(
			normalizeTranscriptionResponse("xai", { text: "x", duration: 1 }),
		).toEqual({ text: "x", duration: 1 });
	});

	test("/v1/audio/transcriptions rejects keyterms for ElevenLabs Scribe", async () => {
		await seedKeys("real-token-scribe-kt", "token-id-scribe-kt");
		await seedElevenLabsKey("token-id-scribe-kt");

		const form = buildForm("scribe-v3");
		form.append("keyterm", "LLM Gateway");
		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: { Authorization: "Bearer real-token-scribe-kt" },
			body: form,
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("unsupported_parameter");
		expect(json.error.param).toBe("keyterm");
	});

	test("/v1/audio/transcriptions rejects unknown models", async () => {
		await seedKeys("real-token-stt-unknown", "token-id-stt-unknown");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt-unknown",
			},
			body: buildForm("not-a-transcription-model"),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("model_not_found");
	});

	test("/v1/audio/transcriptions rejects requests without file or url", async () => {
		await seedKeys("real-token-stt-nofile", "token-id-stt-nofile");

		const form = new FormData();
		form.append("model", "grok-stt-1-0");
		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt-nofile",
			},
			body: form,
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.message).toContain("file");
	});

	test("/v1/audio/transcriptions rejects non-multipart requests", async () => {
		await seedKeys("real-token-stt-json", "token-id-stt-json");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-stt-json",
			},
			body: JSON.stringify({ model: "grok-stt-1-0" }),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("invalid_content_type");
	});

	test("/v1/audio/transcriptions rejects a media type that only mentions multipart in a parameter", async () => {
		await seedKeys("real-token-stt-param", "token-id-stt-param");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				"Content-Type": 'application/json; note="multipart/form-data"',
				Authorization: "Bearer real-token-stt-param",
			},
			body: JSON.stringify({ model: "grok-stt-1-0" }),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe("invalid_content_type");
	});

	test("/v1/audio/transcriptions accepts a case variant of multipart/form-data", async () => {
		await seedKeys("real-token-stt-case", "token-id-stt-case");

		const req = new Request("http://localhost/v1/audio/transcriptions", {
			method: "POST",
			headers: { Authorization: "Bearer real-token-stt-case" },
			body: buildForm("grok-stt-1-0"),
		});
		req.headers.set(
			"Content-Type",
			(req.headers.get("Content-Type") ?? "").replace(
				"multipart/form-data",
				"Multipart/Form-Data",
			),
		);
		const res = await app.request(req);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.text).toBe("The balance is $167,983.15.");
	});

	test("/v1/audio/transcriptions surfaces upstream errors", async () => {
		await seedKeys("real-token-stt-error", "token-id-stt-error");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt-error",
			},
			body: buildForm("grok-stt-1-0", "TRIGGER_ERROR.mp3"),
		});

		expect(res.status).toBe(500);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "xai/grok-stt-1-0");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(true);
	});

	test("/v1/audio/transcriptions persists the payload for a retaining org", async () => {
		await seedKeys("real-token-stt-retain", "token-id-stt-retain");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt-retain",
			},
			body: buildForm("grok-stt-1-0"),
		});

		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "xai/grok-stt-1-0");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		// The org retains payloads, so the transcript summary survives insertLog.
		expect(log?.content).toBeTruthy();
	});

	test("/v1/audio/transcriptions does not persist payload when retention is disabled", async () => {
		await db
			.update(tables.organization)
			.set({ retentionLevel: "none" })
			.where(eq(tables.organization.id, "org-id"));

		await seedKeys("real-token-stt-none", "token-id-stt-none");

		const res = await app.request("/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token-stt-none",
			},
			body: buildForm("grok-stt-1-0"),
		});

		expect(res.status).toBe(200);

		const logs = await waitForLogs(1);
		const log = logs.find((l) => l.usedModel === "xai/grok-stt-1-0");
		expect(log).toBeDefined();
		expect(log?.hasError).toBe(false);
		expect(log?.content).toBeNull();
		expect(log?.messages).toBeNull();
	});
});
