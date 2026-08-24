import { EventEmitter } from "node:events";

import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import {
	closeRealtimeSessionRecord,
	getUnsettledRealtimeOrganizationSpend,
	recordRealtimeResponse,
} from "./billing.js";
import { GeminiRealtimeProxySession } from "./gemini-session.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { WebSocket } from "ws";

vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberWithinBudget: vi.fn(async () => {}),
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(async () => ({
		id: "key_1",
		status: "active",
		createdBy: "user_1",
	})),
	findOrganizationById: vi.fn(async () => ({
		id: "org_1",
		status: "active",
		credits: "10",
		devPlan: "none",
		chatPlan: "none",
	})),
	findProjectById: vi.fn(async () => ({ id: "proj_1", status: "active" })),
}));

vi.mock("@/lib/provider-rate-limit.js", () => ({
	checkProviderRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/iam.js", () => ({
	validateRequestModelAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/compliance.js", () => ({
	assertProviderCompliant: vi.fn(async () => {}),
}));

vi.mock("@llmgateway/db", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getEffectiveDiscount: vi.fn(async () => ({ discount: 0 })),
}));

vi.mock("./billing.js", () => ({
	closeRealtimeSessionRecord: vi.fn(async () => {}),
	getUnsettledRealtimeOrganizationSpend: vi.fn(async () => new Decimal(0)),
	recordRealtimeResponse: vi.fn(async () => ({ inserted: true })),
}));

vi.mock("./leases.js", () => ({
	LEASE_HEARTBEAT_INTERVAL_MS: 30_000,
	releaseRealtimeLease: vi.fn(async () => {}),
	renewRealtimeLease: vi.fn(async () => {}),
}));

vi.mock("./preflight.js", () => ({
	getAvailableCredits: (org: { credits?: string }) =>
		parseFloat(org.credits ?? "0"),
}));

class FakeSocket extends EventEmitter {
	public readyState = 1;
	public sent: string[] = [];
	public closed: Array<{ code: number; reason?: string }> = [];

	public send(text: string): void {
		this.sent.push(text);
	}

	public ping(): void {}

	public pause(): void {}

	public resume(): void {}

	public close(code: number, reason?: string): void {
		this.readyState = 3;
		this.closed.push({ code, reason });
	}

	public terminate(): void {
		this.readyState = 3;
	}

	public get bufferedAmount(): number {
		return 0;
	}
}

const validUsage = {
	promptTokenCount: 120,
	responseTokenCount: 80,
	totalTokenCount: 200,
	promptTokensDetails: [
		{ modality: "AUDIO", tokenCount: 100 },
		{ modality: "TEXT", tokenCount: 20 },
	],
	responseTokensDetails: [
		{ modality: "AUDIO", tokenCount: 75 },
		{ modality: "TEXT", tokenCount: 5 },
	],
};

function buildPreflight(): RealtimePreflightResult {
	return {
		apiKey: { id: "key_1", status: "active", createdBy: "user_1" },
		project: { id: "proj_1", organizationId: "org_1", mode: "credits" },
		organization: { id: "org_1", status: "active" },
		match: {
			modelId: "gemini-2.5-flash-native-audio-preview-12-2025",
			modelDef: { id: "gemini-2.5-flash-native-audio-preview-12-2025" },
			mapping: {
				providerId: "google-ai-studio",
				externalId: "gemini-2.5-flash-native-audio-preview-12-2025",
				inputPrice: "0.5e-6",
				cachedInputPrice: "0.5e-6",
				inputAudioPrice: "3.0e-6",
				cachedInputAudioPrice: "3.0e-6",
				outputPrice: "2.0e-6",
				outputAudioPrice: "12.0e-6",
				requestPrice: "0",
			},
		},
		providerKey: undefined,
		upstreamToken: "goog-upstream",
		usedApiKeyHash: "hash",
		envVarName: undefined,
		configIndex: 0,
		usedMode: "credits",
		allowedTranscriptionModelIds: [],
		clientIp: "198.51.100.4",
		safetyIdentifier: "safety",
	} as unknown as RealtimePreflightResult;
}

async function flush(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

const validSetup = {
	setup: {
		model: "gemini-2.5-flash-native-audio-preview-12-2025",
		generationConfig: {
			responseModalities: ["AUDIO"],
			speechConfig: {
				voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
			},
		},
		inputAudioTranscription: {},
		outputAudioTranscription: {},
	},
};

function createSession(
	preflightOverrides: Record<string, unknown> = {},
	pinned: { instructions?: string | null; voice?: string | null } = {},
) {
	const client = new FakeSocket();
	const upstream = new FakeSocket();
	const session = new GeminiRealtimeProxySession({
		clientSocket: client as unknown as WebSocket,
		upstreamSocket: upstream as unknown as WebSocket,
		preflight: {
			...buildPreflight(),
			...preflightOverrides,
		} as RealtimePreflightResult,
		gatewayToken: "llmgtwy_test",
		requestedModel:
			"google-ai-studio/gemini-2.5-flash-native-audio-preview-12-2025",
		sessionRecordId: "rts_g1",
		lease: { sessionId: "rts_g1", organizationId: "org_1", apiKeyId: "key_1" },
		source: "lounge.llmgateway.io",
		userAgent: "vitest",
		pinnedInstructions: pinned.instructions ?? null,
		pinnedVoice: pinned.voice ?? null,
		onClosed: () => {},
	});
	const clientSends = (message: Record<string, unknown>) => {
		client.emit("message", Buffer.from(JSON.stringify(message)), false);
	};
	const upstreamSends = (message: Record<string, unknown>) => {
		upstream.emit("message", Buffer.from(JSON.stringify(message)));
	};
	const gatewayErrors = () =>
		client.sent
			.map((text) => JSON.parse(text) as Record<string, unknown>)
			.filter((message) => message.llmgatewayError !== undefined)
			.map(
				(message) =>
					(message.llmgatewayError as { code: string; message: string }).code,
			);
	return {
		client,
		upstream,
		session,
		clientSends,
		upstreamSends,
		gatewayErrors,
	};
}

/** Complete the setup handshake so the session accepts ordinary traffic. */
async function openSession(overrides: Record<string, unknown> = {}) {
	const harness = createSession(overrides);
	harness.clientSends(validSetup);
	await flush();
	harness.upstreamSends({ setupComplete: {} });
	await flush();
	harness.upstream.sent.length = 0;
	harness.client.sent.length = 0;
	return harness;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("GeminiRealtimeProxySession setup", () => {
	it("overwrites the setup model with the pinned upstream id", async () => {
		const { upstream, session, clientSends } = createSession();

		clientSends({
			setup: {
				model: "models/gemini-3.0-something-else",
				generationConfig: { responseModalities: ["AUDIO"] },
			},
		});
		await flush();

		expect(upstream.sent).toHaveLength(1);
		expect(JSON.parse(upstream.sent[0]).setup.model).toBe(
			"models/gemini-2.5-flash-native-audio-preview-12-2025",
		);

		session.shutdown(1000, "test_done");
	});

	it("rejects traffic sent before setupComplete", async () => {
		const { upstream, session, clientSends, gatewayErrors } = createSession();

		clientSends(validSetup);
		await flush();
		clientSends({ realtimeInput: { text: "hello" } });
		await flush();

		expect(gatewayErrors()).toEqual(["setup_required"]);
		// Only the setup message reached the provider.
		expect(upstream.sent).toHaveLength(1);

		session.shutdown(1000, "test_done");
	});

	it("rejects a second setup message", async () => {
		const { session, clientSends, gatewayErrors } = await openSession();

		clientSends(validSetup);
		await flush();

		expect(gatewayErrors()).toEqual(["setup_already_sent"]);

		session.shutdown(1000, "test_done");
	});

	it("rejects a message carrying more than one payload field", async () => {
		const { session, clientSends, gatewayErrors } = await openSession();

		clientSends({
			clientContent: { turns: [] },
			realtimeInput: { text: "hi" },
		});
		await flush();

		expect(gatewayErrors()).toEqual(["invalid_client_message"]);

		session.shutdown(1000, "test_done");
	});

	it.each([
		["responseModalities", { responseModalities: ["AUDIO"] }],
		[
			"speechConfig",
			{
				generationConfig: { responseModalities: ["AUDIO"] },
				speechConfig: { voiceConfig: {} },
			},
		],
		[
			"nested transcription",
			{
				generationConfig: {
					responseModalities: ["AUDIO"],
					inputAudioTranscription: {},
				},
			},
		],
	])("rejects misplaced setup field: %s", async (_label, setup) => {
		const { upstream, session, clientSends, gatewayErrors } = createSession();

		clientSends({ setup });
		await flush();

		expect(gatewayErrors()).toEqual(["invalid_setup_nesting"]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("requires the audio response modality", async () => {
		const { upstream, session, clientSends, gatewayErrors } = createSession();

		clientSends({
			setup: { generationConfig: { responseModalities: ["TEXT"] } },
		});
		await flush();

		expect(gatewayErrors()).toEqual(["audio_modality_required"]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("accepts inline function declarations but rejects hosted tools", async () => {
		const allowed = createSession();
		allowed.clientSends({
			setup: {
				generationConfig: { responseModalities: ["AUDIO"] },
				tools: [{ functionDeclarations: [{ name: "get_weather" }] }],
			},
		});
		await flush();
		expect(allowed.upstream.sent).toHaveLength(1);
		allowed.session.shutdown(1000, "test_done");

		const rejected = createSession();
		rejected.clientSends({
			setup: {
				generationConfig: { responseModalities: ["AUDIO"] },
				tools: [{ googleSearch: {} }],
			},
		});
		await flush();
		expect(rejected.gatewayErrors()).toEqual(["tool_type_not_supported"]);
		expect(rejected.upstream.sent).toHaveLength(0);
		rejected.session.shutdown(1000, "test_done");
	});

	it("rejects stored context caches", async () => {
		const { upstream, session, clientSends, gatewayErrors } = createSession();

		clientSends({
			setup: {
				generationConfig: { responseModalities: ["AUDIO"] },
				cachedContent: "cachedContents/abc",
			},
		});
		await flush();

		expect(gatewayErrors()).toEqual(["cached_content_not_supported"]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});
});

describe("GeminiRealtimeProxySession client input validation", () => {
	it("forwards PCM audio, text, and activity signals", async () => {
		const { upstream, session, clientSends } = await openSession();

		clientSends({
			realtimeInput: {
				audio: { data: "AAA=", mimeType: "audio/pcm;rate=16000" },
			},
		});
		await flush();
		clientSends({ realtimeInput: { text: "hello" } });
		await flush();
		clientSends({ realtimeInput: { activityEnd: {} } });
		await flush();

		expect(upstream.sent).toHaveLength(3);

		session.shutdown(1000, "test_done");
	});

	it.each([
		[
			"video",
			{ video: { data: "AAA=", mimeType: "video/mp4" } },
			"video_input_not_supported",
		],
		[
			"mediaChunks",
			{ mediaChunks: [{ data: "AAA=", mimeType: "image/png" }] },
			"media_chunks_not_supported",
		],
		[
			"non-audio blob",
			{ audio: { data: "AAA=", mimeType: "image/png" } },
			"invalid_audio_blob",
		],
		[
			"file data",
			{ fileData: { fileUri: "files/abc" } },
			"invalid_realtime_input",
		],
	])("rejects realtimeInput.%s", async (_label, input, expectedCode) => {
		const { upstream, session, clientSends, gatewayErrors } =
			await openSession();

		clientSends({ realtimeInput: input });
		await flush();

		expect(gatewayErrors()).toEqual([expectedCode]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("rejects non-text parts in clientContent", async () => {
		const { upstream, session, clientSends, gatewayErrors } =
			await openSession();

		clientSends({
			clientContent: {
				turns: [
					{
						role: "user",
						parts: [{ inlineData: { data: "AAA=", mimeType: "image/png" } }],
					},
				],
				turnComplete: true,
			},
		});
		await flush();

		expect(gatewayErrors()).toEqual(["content_type_not_supported"]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("rejects media embedded in a function response", async () => {
		const { upstream, session, clientSends, gatewayErrors } =
			await openSession();

		clientSends({
			toolResponse: {
				functionResponses: [
					{
						name: "get_photo",
						response: {
							result: { fileData: { fileUri: "files/abc" } },
						},
					},
				],
			},
		});
		await flush();

		expect(gatewayErrors()).toEqual(["content_type_not_supported"]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("forwards a plain function response", async () => {
		const { upstream, session, clientSends } = await openSession();

		clientSends({
			toolResponse: {
				functionResponses: [
					{ id: "call_1", name: "get_weather", response: { degrees: 21 } },
				],
			},
		});
		await flush();

		expect(upstream.sent).toHaveLength(1);

		session.shutdown(1000, "test_done");
	});
});

describe("GeminiRealtimeProxySession billing", () => {
	it("bills a completed turn once before forwarding turnComplete", async () => {
		const { client, session, upstreamSends } = await openSession();

		upstreamSends({
			serverContent: { modelTurn: { parts: [{ text: "hi" }] } },
		});
		await flush();
		upstreamSends({ usageMetadata: validUsage });
		await flush();
		expect(recordRealtimeResponse).not.toHaveBeenCalled();

		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(recordRealtimeResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseId: "gusage-1",
				responseStatus: "completed",
			}),
		);
		// The terminal event reaches the client only after the charge landed.
		expect(client.sent.some((m) => m.includes("turnComplete"))).toBe(true);

		session.shutdown(1000, "test_done");
	});

	it("charges a usage snapshot once even when it is resent in the stage", async () => {
		const { session, upstreamSends } = await openSession();

		upstreamSends({
			usageMetadata: {
				...validUsage,
				responseTokenCount: 40,
				totalTokenCount: 160,
				responseTokensDetails: [{ modality: "AUDIO", tokenCount: 40 }],
			},
		});
		await flush();
		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		// The latest snapshot wins; earlier ones are replaced, not added.
		expect(recordRealtimeResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				usage: expect.objectContaining({ outputTokens: 80 }),
			}),
		);

		session.shutdown(1000, "test_done");
	});

	it("bills a function-call stage before forwarding its toolCall", async () => {
		const { client, session, upstreamSends } = await openSession();

		upstreamSends({
			toolCall: { functionCalls: [{ id: "call_1", name: "get_weather" }] },
			usageMetadata: validUsage,
		});
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(client.sent.some((m) => m.includes("toolCall"))).toBe(true);

		session.shutdown(1000, "test_done");
	});

	it("marks an interrupted stage as cancelled", async () => {
		const { session, upstreamSends } = await openSession();

		upstreamSends({ serverContent: { interrupted: true } });
		await flush();
		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseStatus: "cancelled" }),
		);

		session.shutdown(1000, "test_done");
	});

	it("skips the log row at a zero-usage turnComplete but still re-checks limits", async () => {
		const { session, upstreamSends } = await openSession();

		upstreamSends({
			usageMetadata: {
				promptTokenCount: 0,
				responseTokenCount: 0,
				totalTokenCount: 0,
			},
		});
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(recordRealtimeResponse).not.toHaveBeenCalled();
		expect(checkProviderRateLimit).toHaveBeenCalled();

		session.shutdown(1000, "test_done");
	});

	it("numbers consecutive billed stages", async () => {
		const { session, upstreamSends } = await openSession();

		for (let i = 0; i < 2; i++) {
			upstreamSends({ usageMetadata: validUsage });
			await flush();
			upstreamSends({ serverContent: { turnComplete: true } });
			await flush();
		}

		expect(recordRealtimeResponse).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ responseId: "gusage-1" }),
		);
		expect(recordRealtimeResponse).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ responseId: "gusage-2" }),
		);

		session.shutdown(1000, "test_done");
	});

	it("closes the session on malformed usage rather than delivering it", async () => {
		const { client, upstreamSends } = await openSession();

		upstreamSends({ usageMetadata: { promptTokenCount: -5 } });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(recordRealtimeResponse).not.toHaveBeenCalled();
		expect(client.sent.some((m) => m.includes("turnComplete"))).toBe(false);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"error",
			expect.stringContaining("unpriceable_usage"),
			expect.anything(),
		);
	});

	it("closes the session on a toolCall with no usage metadata", async () => {
		const { client, upstreamSends } = await openSession();

		upstreamSends({ toolCall: { functionCalls: [{ name: "get_weather" }] } });
		await flush();

		expect(client.sent.some((m) => m.includes("toolCall"))).toBe(false);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"error",
			"unbillable_generation",
			expect.anything(),
		);
	});

	it("closes the session when persistence fails", async () => {
		const { client, upstreamSends } = await openSession();
		vi.mocked(recordRealtimeResponse).mockRejectedValueOnce(
			new Error("db down"),
		);

		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(client.sent.some((m) => m.includes("turnComplete"))).toBe(false);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"error",
			"billing_unavailable",
			expect.anything(),
		);
	});
});

describe("GeminiRealtimeProxySession post-billing gates", () => {
	it("closes the session when credits ran out during the billed turn", async () => {
		const { client, upstreamSends } = await openSession();
		vi.mocked(getUnsettledRealtimeOrganizationSpend).mockResolvedValueOnce(
			new Decimal("25"),
		);

		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		// The already-incurred generation is delivered and charged...
		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(client.sent.some((m) => m.includes("turnComplete"))).toBe(true);
		// ...and only then does the session close.
		expect(client.sent.some((m) => m.includes("insufficient_credits"))).toBe(
			true,
		);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			"insufficient_credits",
			expect.anything(),
		);
	});

	it("closes the session when the provider rate limit is exhausted", async () => {
		const { client, upstreamSends } = await openSession();
		vi.mocked(checkProviderRateLimit).mockResolvedValueOnce({
			allowed: false,
			retryAfter: 12,
		} as Awaited<ReturnType<typeof checkProviderRateLimit>>);

		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(client.sent.some((m) => m.includes("rate_limit_exceeded"))).toBe(
			true,
		);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			"rate_limit_exceeded",
			expect.anything(),
		);
	});
});

describe("GeminiRealtimeProxySession upstream passthrough", () => {
	it("forwards a real upstream error frame unchanged", async () => {
		const { client, session, upstreamSends } = await openSession();

		upstreamSends({ error: { code: 400, message: "Bad setup" } });
		await flush();

		const forwarded = JSON.parse(client.sent[0]) as Record<string, unknown>;
		expect(forwarded.error).toEqual({ code: 400, message: "Bad setup" });
		expect(forwarded.llmgatewayError).toBeUndefined();

		session.shutdown(1000, "test_done");
	});

	it("namespaces gateway-generated errors away from upstream errors", async () => {
		const { client, session, clientSends } = await openSession();

		clientSends({ realtimeInput: { video: {} } });
		await flush();

		const emitted = JSON.parse(client.sent[0]) as Record<string, unknown>;
		expect(emitted.error).toBeUndefined();
		expect(emitted.llmgatewayError).toMatchObject({
			code: "video_input_not_supported",
		});

		session.shutdown(1000, "test_done");
	});

	it("forwards a session resumption handle without persisting it", async () => {
		const { client, session, upstreamSends } = await openSession();

		upstreamSends({
			sessionResumptionUpdate: { newHandle: "secret-handle", resumable: true },
		});
		await flush();

		expect(client.sent[0]).toContain("secret-handle");
		// No billing/session-record write may carry the handle.
		for (const call of vi.mocked(recordRealtimeResponse).mock.calls) {
			expect(JSON.stringify(call)).not.toContain("secret-handle");
		}

		session.shutdown(1000, "test_done");
	});

	it("forwards goAway and leaves the call to end", async () => {
		const { client, session, upstreamSends } = await openSession();

		upstreamSends({ goAway: { timeLeft: "5s" } });
		await flush();

		expect(client.sent.some((m) => m.includes("goAway"))).toBe(true);
		expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();

		session.shutdown(1000, "test_done");
	});

	it("carries the upstream close reason into the client close reason", async () => {
		const { client, upstream } = await openSession();

		// Gemini reports a bad key, unknown model or malformed setup by closing
		// the socket, not by sending an error message.
		upstream.emit(
			"close",
			1007,
			Buffer.from("API key not valid. Please pass a valid API key."),
		);
		await flush();

		expect(client.closed[0]).toMatchObject({
			code: 1011,
			reason:
				"upstream_closed_1007: API key not valid. Please pass a valid API key.",
		});
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			expect.stringContaining("API key not valid"),
			expect.anything(),
		);
	});

	it("treats a clean upstream close as a normal end of call", async () => {
		const { client, upstream } = await openSession();

		upstream.emit("close", 1000, Buffer.from(""));
		await flush();

		expect(client.closed[0]).toMatchObject({
			code: 1000,
			reason: "upstream_closed",
		});
	});

	it("charges the buffered tail when the upstream disconnects", async () => {
		const { upstream, upstreamSends } = await openSession();

		// A snapshot arrives, then the socket dies before the turnComplete that
		// would normally close the stage. The provider still charged for it.
		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstream.emit("close", 1006, Buffer.from(""));
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(recordRealtimeResponse).toHaveBeenCalledWith(
			expect.objectContaining({ responseStatus: "cancelled" }),
		);
	});

	it("does not re-charge a tail an earlier terminal event already billed", async () => {
		const { upstream, upstreamSends } = await openSession();

		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();
		upstream.emit("close", 1000, Buffer.from(""));
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
	});

	it("closes the session on an unparseable upstream frame", async () => {
		const { upstream } = await openSession();

		upstream.emit("message", Buffer.from("not json"));
		await flush();

		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"error",
			"upstream_protocol_error",
			expect.anything(),
		);
	});
});

describe("GeminiRealtimeProxySession draining", () => {
	it("closes the audio stream and waits for the billable tail on disconnect", async () => {
		const { client, upstream, clientSends, upstreamSends } =
			await openSession();

		clientSends({
			realtimeInput: {
				audio: { data: "AAA=", mimeType: "audio/pcm;rate=16000" },
			},
		});
		await flush();
		upstream.sent.length = 0;

		client.readyState = 3;
		client.emit("close");
		await flush();

		expect(upstream.sent.some((m) => m.includes("audioStreamEnd"))).toBe(true);
		// Still draining: the session must not finalize before the usage lands.
		expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();

		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);
	});

	// Regression: streamed audio used to keep the drain condition armed forever,
	// so every hang-up after a completed turn sat out the full drain timeout
	// instead of closing at once.
	it("closes immediately when the last turn already completed", async () => {
		const { client, clientSends, upstreamSends } = await openSession();

		clientSends({
			realtimeInput: {
				audio: { data: "AAA=", mimeType: "audio/pcm;rate=16000" },
			},
		});
		await flush();
		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		client.readyState = 3;
		client.emit("close");
		await flush();

		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);
	});

	// The provider charges for a generation as soon as it reports the usage
	// snapshot. If the terminal event never arrives, shutting down without
	// charging it means Google bills us and the customer is not billed at all.
	it("charges a buffered usage snapshot when the drain times out", async () => {
		process.env.REALTIME_DRAIN_TIMEOUT_MS = "20";
		try {
			const { client, clientSends, upstreamSends } = await openSession();

			clientSends({
				realtimeInput: {
					audio: { data: "AAA=", mimeType: "audio/pcm;rate=16000" },
				},
			});
			await flush();
			// Usage arrives, but the turnComplete that would close the stage never
			// does — the client vanishes first.
			upstreamSends({ usageMetadata: validUsage });
			await flush();

			client.readyState = 3;
			client.emit("close");
			await new Promise((resolve) => setTimeout(resolve, 60));
			await flush();

			expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
			expect(recordRealtimeResponse).toHaveBeenCalledWith(
				expect.objectContaining({ responseStatus: "cancelled" }),
			);
			expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
				"rts_g1",
				"closed",
				"client_disconnected_drain_timeout",
				expect.anything(),
			);
		} finally {
			delete process.env.REALTIME_DRAIN_TIMEOUT_MS;
		}
	});

	it("charges a buffered usage snapshot when the server force-closes", async () => {
		const { session, upstreamSends } = await openSession();

		upstreamSends({ usageMetadata: validUsage });
		await flush();

		session.close(1001, "server_shutdown");
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			"server_shutdown",
			expect.anything(),
		);
	});

	it("does not double-charge a stage already billed at its terminal event", async () => {
		const { session, upstreamSends } = await openSession();

		upstreamSends({ usageMetadata: validUsage });
		await flush();
		upstreamSends({ serverContent: { turnComplete: true } });
		await flush();

		session.close(1001, "server_shutdown");
		await flush();

		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
	});

	it("closes immediately when nothing billable is outstanding", async () => {
		const { client } = await openSession();

		client.readyState = 3;
		client.emit("close");
		await flush();

		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_g1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);
	});
});

describe("GeminiRealtimeProxySession pinned instructions", () => {
	const INSTRUCTIONS = "You are the operator's support agent.";

	const baseSetup = {
		model: "gemini-2.5-flash-native-audio-preview-12-2025",
		generationConfig: { responseModalities: ["AUDIO"] },
	};

	it("applies pinned instructions to setup.systemInstruction", async () => {
		const { upstream, session, clientSends } = createSession(
			{},
			{ instructions: INSTRUCTIONS },
		);

		clientSends({ setup: baseSetup });
		await flush();

		const forwarded = JSON.parse(upstream.sent[0]) as {
			setup: { systemInstruction: { parts: { text: string }[] } };
		};
		expect(forwarded.setup.systemInstruction.parts[0].text).toBe(INSTRUCTIONS);

		session.shutdown(1000, "test_done");
	});

	it("rejects a client systemInstruction when instructions are pinned", async () => {
		const { upstream, session, clientSends, gatewayErrors } = createSession(
			{},
			{ instructions: INSTRUCTIONS },
		);

		clientSends({
			setup: {
				...baseSetup,
				systemInstruction: { parts: [{ text: "You are a pirate." }] },
			},
		});
		await flush();

		expect(gatewayErrors()).toEqual(["instructions_locked"]);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("leaves systemInstruction to the client when nothing is pinned", async () => {
		const { upstream, session, clientSends } = createSession();

		clientSends({
			setup: {
				...baseSetup,
				systemInstruction: { parts: [{ text: "client owns this" }] },
			},
		});
		await flush();

		expect(upstream.sent[0]).toContain("client owns this");

		session.shutdown(1000, "test_done");
	});

	it("fills in the pinned voice when the client chose none", async () => {
		const { upstream, session, clientSends } = createSession(
			{},
			{ voice: "Kore" },
		);

		clientSends({ setup: baseSetup });
		await flush();

		const forwarded = JSON.parse(upstream.sent[0]) as {
			setup: {
				generationConfig: {
					responseModalities: string[];
					speechConfig: {
						voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
					};
				};
			};
		};
		expect(
			forwarded.setup.generationConfig.speechConfig.voiceConfig
				.prebuiltVoiceConfig.voiceName,
		).toBe("Kore");
		// Merging the voice must not drop the rest of generationConfig.
		expect(forwarded.setup.generationConfig.responseModalities).toEqual([
			"AUDIO",
		]);

		session.shutdown(1000, "test_done");
	});

	it("does not override a voice the client chose explicitly", async () => {
		const { upstream, session, clientSends } = createSession(
			{},
			{ voice: "Kore" },
		);

		clientSends({
			setup: {
				...baseSetup,
				generationConfig: {
					responseModalities: ["AUDIO"],
					speechConfig: {
						voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
					},
				},
			},
		});
		await flush();

		const forwarded = JSON.parse(upstream.sent[0]) as {
			setup: {
				generationConfig: {
					speechConfig: {
						voiceConfig: { prebuiltVoiceConfig: { voiceName: string } };
					};
				};
			};
		};
		expect(
			forwarded.setup.generationConfig.speechConfig.voiceConfig
				.prebuiltVoiceConfig.voiceName,
		).toBe("Puck");

		session.shutdown(1000, "test_done");
	});
});
