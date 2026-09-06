import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realtimeClientSecretsRoute } from "./client-secrets-route.js";

const mocks = vi.hoisted(() => ({
	createClientSecret: vi.fn(),
	runRealtimePreflight: vi.fn(),
}));

vi.mock("@/lib/extract-api-token.js", () => ({
	extractApiToken: () => "test-token",
}));

vi.mock("./client-secrets.js", () => ({
	clampClientSecretTtl: () => 60,
	createClientSecret: mocks.createClientSecret,
	MAX_CLIENT_SECRET_INSTRUCTIONS_TOKENS: 16_384,
}));

vi.mock("./preflight.js", () => ({
	runRealtimePreflight: mocks.runRealtimePreflight,
}));

describe("realtime client secrets route", () => {
	const previousRealtimeEnabled = process.env.REALTIME_ENABLED;

	beforeEach(() => {
		process.env.REALTIME_ENABLED = "true";
		mocks.createClientSecret.mockResolvedValue({
			value: "ek_test",
			expiresAt: 123,
		});
		mocks.runRealtimePreflight.mockResolvedValue({
			sessionType: "realtime",
			match: {
				modelId: "gpt-realtime-2.1-mini",
				mapping: {
					providerId: "openai",
					supportedVoices: ["marin", "cedar"],
				},
			},
			allowedTranscriptionModelIds: [],
			project: { organizationId: "org_test" },
			organization: {
				id: "org_test",
				plan: "pro",
				providerCompliancePolicy: null,
			},
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		if (previousRealtimeEnabled === undefined) {
			delete process.env.REALTIME_ENABLED;
		} else {
			process.env.REALTIME_ENABLED = previousRealtimeEnabled;
		}
	});

	it("stores and returns the canonical model", async () => {
		const response = await realtimeClientSecretsRoute.request(
			"/client_secrets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					session: { type: "realtime", model: "gpt-realtime-mini" },
				}),
			},
		);

		expect(response.status).toBe(200);
		expect(mocks.createClientSecret).toHaveBeenCalledWith(
			expect.objectContaining({ model: "openai/gpt-realtime-2.1-mini" }),
		);
		expect((await response.json()).session.model).toBe(
			"openai/gpt-realtime-2.1-mini",
		);
	});

	async function mint(session: Record<string, unknown>) {
		return await realtimeClientSecretsRoute.request("/client_secrets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				session: { type: "realtime", model: "gpt-realtime-mini", ...session },
			}),
		});
	}

	it("pins instructions and voice on the secret", async () => {
		const response = await mint({
			instructions: "You are a support agent.",
			audio: { output: { voice: "marin" } },
		});

		expect(response.status).toBe(200);
		expect(mocks.createClientSecret).toHaveBeenCalledWith(
			expect.objectContaining({
				instructions: "You are a support agent.",
				voice: "marin",
			}),
		);
	});

	it("does not echo pinned instructions back to the caller", async () => {
		const response = await mint({ instructions: "secret prompt" });

		expect(JSON.stringify(await response.json())).not.toContain(
			"secret prompt",
		);
	});

	it("rejects pinned instructions while ZDR is active", async () => {
		mocks.runRealtimePreflight.mockResolvedValueOnce({
			match: {
				modelId: "gpt-realtime-2.1-mini",
				mapping: {
					providerId: "openai",
					supportedVoices: ["marin", "cedar"],
				},
			},
			allowedTranscriptionModelIds: [],
			project: { organizationId: "org_test" },
			organization: {
				id: "org_test",
				plan: "enterprise",
				providerCompliancePolicy: {
					enabled: true,
					zeroDataRetention: true,
				},
			},
		});

		const response = await mint({ instructions: "secret prompt" });

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("zdr_storage_conflict");
		expect(mocks.createClientSecret).not.toHaveBeenCalled();
	});

	it("defaults instructions and voice to null when not pinned", async () => {
		await mint({});

		expect(mocks.createClientSecret).toHaveBeenCalledWith(
			expect.objectContaining({ instructions: null, voice: null }),
		);
	});

	// The mint estimates chars/4, so this many characters sits exactly on the
	// 16,384-token limit.
	const charsAtCeiling = 4 * 16_384;

	it("rejects instructions over the token ceiling", async () => {
		const response = await mint({
			instructions: "x".repeat(charsAtCeiling + 8),
		});

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("instructions_too_large");
		expect(mocks.createClientSecret).not.toHaveBeenCalled();
	});

	it("accepts instructions just under the token ceiling", async () => {
		const response = await mint({ instructions: "x".repeat(charsAtCeiling) });

		expect(response.status).toBe(200);
	});

	it("rejects a voice the model does not support", async () => {
		const response = await mint({
			audio: { output: { voice: "not-a-voice" } },
		});

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("voice_not_supported");
		expect(mocks.createClientSecret).not.toHaveBeenCalled();
	});

	it("mints transcription session secrets", async () => {
		mocks.runRealtimePreflight.mockResolvedValue({
			sessionType: "transcription",
			match: {
				modelId: "gpt-live-transcribe",
				mapping: { providerId: "openai" },
			},
			allowedTranscriptionModelIds: ["gpt-live-transcribe"],
			project: { organizationId: "org_test" },
		});

		const response = await realtimeClientSecretsRoute.request(
			"/client_secrets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					session: {
						type: "transcription",
						audio: {
							input: { transcription: { model: "gpt-live-transcribe" } },
						},
					},
				}),
			},
		);

		expect(response.status).toBe(200);
		expect(mocks.runRealtimePreflight).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedModel: "gpt-live-transcribe",
				intent: "transcription",
			}),
		);
		expect(mocks.createClientSecret).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "openai/gpt-live-transcribe",
				sessionType: "transcription",
				transcriptionModel: null,
				instructions: null,
				voice: null,
			}),
		);
		expect((await response.json()).session).toEqual({
			type: "transcription",
			audio: {
				input: { transcription: { model: "openai/gpt-live-transcribe" } },
			},
		});
	});

	it("rejects a transcription model as a realtime session model", async () => {
		mocks.runRealtimePreflight.mockResolvedValue({
			sessionType: "transcription",
			match: {
				modelId: "gpt-live-transcribe",
				mapping: { providerId: "openai" },
			},
			allowedTranscriptionModelIds: ["gpt-live-transcribe"],
			project: { organizationId: "org_test" },
		});

		const response = await realtimeClientSecretsRoute.request(
			"/client_secrets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					session: { type: "realtime", model: "gpt-live-transcribe" },
				}),
			},
		);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("model_not_found");
		expect(mocks.createClientSecret).not.toHaveBeenCalled();
	});

	it("rejects transcription sessions without a model", async () => {
		const response = await realtimeClientSecretsRoute.request(
			"/client_secrets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					session: { type: "transcription", audio: { input: {} } },
				}),
			},
		);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("invalid_request");
	});

	it("still rejects unknown session fields", async () => {
		const response = await mint({ temperature: 0.5 });

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("invalid_request");
	});
});
