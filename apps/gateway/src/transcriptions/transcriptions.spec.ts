import { describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { db, tables } from "@llmgateway/db";

describe("transcriptions", () => {
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
			id: `provider-key-xai-${apiKeyId}`,
			token: "xai-test-key",
			provider: "xai",
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
});
