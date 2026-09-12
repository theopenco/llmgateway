import { EventEmitter } from "node:events";

import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertMemberProjectAccess } from "@/lib/api-key-usage-limits.js";
import { findApiKeyByToken } from "@/lib/cached-queries.js";
import { validateRequestModelAccess } from "@/lib/iam.js";
import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import {
	closeRealtimeSessionRecord,
	recordRealtimeResponse,
	recordRealtimeTranscription,
} from "./billing.js";
import { RealtimeProxySession } from "./session.js";

import type { RealtimeMappingMatch } from "./catalog.js";
import type { RealtimePreflightResult } from "./preflight.js";
import type { WebSocket } from "ws";

vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberProjectAccess: vi.fn(async () => {}),
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
	findProjectById: vi.fn(async () => ({
		id: "proj_1",
		status: "active",
	})),
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
	markRealtimeSessionUpstream: vi.fn(async () => {}),
	recordRealtimeResponse: vi.fn(async () => ({ inserted: true })),
	recordRealtimeTranscription: vi.fn(async () => ({ inserted: true })),
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

const validResponseUsage = {
	total_tokens: 30,
	input_tokens: 20,
	output_tokens: 10,
	input_token_details: {
		text_tokens: 2,
		audio_tokens: 18,
		image_tokens: 0,
		cached_tokens: 0,
		cached_tokens_details: {},
	},
	output_token_details: {
		text_tokens: 4,
		audio_tokens: 6,
	},
};

function buildPreflight(): RealtimePreflightResult {
	return {
		apiKey: { id: "key_1", status: "active", createdBy: "user_1" },
		project: { id: "proj_1", organizationId: "org_1", mode: "api-keys" },
		organization: { id: "org_1", status: "active" },
		match: {
			modelId: "gpt-realtime-2.1-mini",
			modelDef: { id: "gpt-realtime-2.1-mini" },
			mapping: {
				providerId: "openai",
				externalId: "gpt-realtime-2.1-mini",
				inputPrice: "0.6e-6",
				cachedInputPrice: "0.06e-6",
				outputPrice: "2.4e-6",
				inputAudioPrice: "10.0e-6",
				cachedInputAudioPrice: "0.3e-6",
				outputAudioPrice: "20.0e-6",
			},
		},
		providerKey: undefined,
		upstreamToken: "sk-upstream",
		usedApiKeyHash: "hash",
		envVarName: undefined,
		configIndex: 0,
		usedMode: "api-keys",
		allowedTranscriptionModelIds: [
			"gpt-4o-mini-transcribe",
			"gpt-4o-transcribe",
		],
		clientIp: "198.51.100.4",
		safetyIdentifier: "safety",
	} as unknown as RealtimePreflightResult;
}

async function flush(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

function createSession(
	preflightOverrides: Record<string, unknown> = {},
	allowedTranscription: RealtimeMappingMatch | null = null,
	pinned: { instructions?: string | null; voice?: string | null } = {},
) {
	const client = new FakeSocket();
	const upstream = new FakeSocket();
	const session = new RealtimeProxySession({
		clientSocket: client as unknown as WebSocket,
		upstreamSocket: upstream as unknown as WebSocket,
		preflight: {
			...buildPreflight(),
			...preflightOverrides,
		} as RealtimePreflightResult,
		gatewayToken: "llmgtwy_test",
		requestedModel: "openai/gpt-realtime-2.1-mini",
		sessionRecordId: "rts_1",
		lease: { sessionId: "rts_1", organizationId: "org_1", apiKeyId: "key_1" },
		source: "lounge.llmgateway.io",
		userAgent: "vitest",
		allowedTranscription,
		pinnedInstructions: pinned.instructions ?? null,
		pinnedVoice: pinned.voice ?? null,
		onClosed: () => {},
	});
	const clientSends = (event: Record<string, unknown>) => {
		client.emit("message", Buffer.from(JSON.stringify(event)), false);
	};
	const upstreamSends = (event: Record<string, unknown>) => {
		upstream.emit("message", Buffer.from(JSON.stringify(event)));
	};
	return { client, upstream, session, clientSends, upstreamSends };
}

/**
 * Drive the upstream session.created handshake and clear the buffers, so the
 * test starts from a configured session. Generation is held until the gateway's
 * control session.update has been forwarded, so any test sending
 * response.create needs this first.
 */
async function openSession(harness: ReturnType<typeof createSession>) {
	harness.upstreamSends({ type: "session.created", session: { id: "sess_1" } });
	await flush();
	harness.upstream.sent.length = 0;
	harness.client.sent.length = 0;
	return harness;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("RealtimeProxySession turn handling", () => {
	it("accepts canonical model ids in session updates", async () => {
		const preflight = buildPreflight();
		const { client, upstream, session, clientSends } = await openSession(
			createSession({
				match: {
					...preflight.match,
					mapping: {
						...preflight.match.mapping,
						externalId: "upstream-deployment",
					},
				},
			}),
		);

		clientSends({
			type: "session.update",
			session: { model: "openai/gpt-realtime-2.1-mini" },
		});
		await flush();

		expect(client.sent).toHaveLength(0);
		expect(upstream.sent).toHaveLength(1);
		const forwarded = JSON.parse(upstream.sent[0]) as {
			session: { model: string };
		};
		expect(forwarded.session.model).toBe("upstream-deployment");

		session.shutdown(1000, "test_done");
	});

	it("canonicalizes model ids in upstream lifecycle events", async () => {
		const allowedTranscription = {
			modelId: "gpt-4o-mini-transcribe",
			mapping: { providerId: "openai" },
		} as unknown as RealtimeMappingMatch;
		const { client, session, upstreamSends } = createSession(
			{},
			allowedTranscription,
		);

		upstreamSends({
			type: "session.created",
			session: {
				id: "sess_1",
				model: "upstream-deployment",
				input_audio_transcription: { model: "upstream-transcription" },
			},
		});
		upstreamSends({
			type: "response.created",
			response: { id: "resp_1", model: "upstream-deployment" },
		});
		await flush();

		const events = client.sent.map((value) => JSON.parse(value));
		expect(events[0].session.model).toBe("openai/gpt-realtime-2.1-mini");
		expect(events[0].session.input_audio_transcription.model).toBe(
			"openai/gpt-4o-mini-transcribe",
		);
		expect(events[1].response.model).toBe("openai/gpt-realtime-2.1-mini");

		session.shutdown(1000, "test_done");
	});

	it("starts the pending auto-response only after a commit-during-response's response.done is billed", async () => {
		const { upstream, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({ type: "response.create" });
		await flush();
		expect(
			upstream.sent.filter((m) => m.includes("response.create")),
		).toHaveLength(1);

		upstreamSends({ type: "response.created", response: { id: "resp_1" } });
		await flush();

		// Barge-in: the user's next turn commits while resp_1 is still running.
		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();
		// No second response yet: the in-flight response must finish first.
		expect(
			upstream.sent.filter((m) => m.includes("response.create")),
		).toHaveLength(1);

		upstreamSends({
			type: "response.done",
			response: {
				id: "resp_1",
				status: "cancelled",
				usage: validResponseUsage,
			},
		});
		await flush();

		// The cancelled response was billed...
		expect(recordRealtimeResponse).toHaveBeenCalledTimes(1);
		expect(recordRealtimeResponse).toHaveBeenCalledWith(
			expect.objectContaining({
				responseId: "resp_1",
				responseStatus: "cancelled",
			}),
		);
		// ...and the pending turn then started through the normal gates.
		expect(
			upstream.sent.filter((m) => m.includes("response.create")),
		).toHaveLength(2);

		session.shutdown(1000, "test_done");
	});

	it("does not queue an auto-response for commits when turn detection is disabled", async () => {
		const { upstream, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: { type: "realtime", turn_detection: null },
		});
		await flush();

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();
		expect(
			upstream.sent.filter((m) => m.includes("response.create")),
		).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});
});

describe("RealtimeProxySession authorization", () => {
	it("rejects a transcription model the key's IAM rules do not allow", async () => {
		const { client, upstream, session, clientSends } = await openSession(
			createSession({
				allowedTranscriptionModelIds: ["gpt-4o-mini-transcribe"],
			}),
		);

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { transcription: { model: "gpt-4o-transcribe" } } },
			},
		});
		await flush();

		expect(
			client.sent.some((m) => m.includes("transcription_model_not_allowed")),
		).toBe(true);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("rejects stored prompt references in session.update and response.create", async () => {
		const { client, upstream, session, clientSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: { type: "realtime", prompt: { id: "pmpt_123" } },
		});
		await flush();
		clientSends({
			type: "response.create",
			response: { prompt: { id: "pmpt_123" } },
		});
		await flush();

		expect(
			client.sent.filter((m) => m.includes("prompt_not_supported")),
		).toHaveLength(2);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("closes the session when IAM revokes model access mid-session", async () => {
		const { client, upstream, clientSends } =
			await openSession(createSession());

		vi.mocked(validateRequestModelAccess).mockResolvedValueOnce({
			allowed: false,
			reason: "Model gpt-realtime-2.1-mini is not in the allowed models list",
		});
		clientSends({ type: "response.create" });
		await flush();

		expect(client.sent.some((m) => m.includes("model_access_denied"))).toBe(
			true,
		);
		expect(upstream.sent).toHaveLength(0);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"model_access_denied",
			expect.anything(),
		);
	});

	it("closes the session when team project access is revoked", async () => {
		const { client, upstream, clientSends } =
			await openSession(createSession());

		vi.mocked(assertMemberProjectAccess).mockRejectedValueOnce(
			new Error("Project access has been revoked."),
		);
		clientSends({ type: "response.create" });
		await flush();

		expect(client.sent.some((m) => m.includes("project_access_revoked"))).toBe(
			true,
		);
		expect(upstream.sent).toHaveLength(0);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"project_access_revoked",
			expect.anything(),
		);
	});
});

describe("RealtimeProxySession transcription", () => {
	it("rejects unsupported transcription models in session.update", async () => {
		const { client, upstream, session, clientSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { transcription: { model: "whisper-1" } } },
			},
		});
		await flush();

		expect(
			client.sent.some((m) => m.includes("transcription_model_not_supported")),
		).toBe(true);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("pins the ASR mapping and rewrites the forwarded model to the upstream id", async () => {
		const { client, upstream, session, clientSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: {
					input: {
						transcription: { model: "openai/gpt-4o-mini-transcribe" },
					},
				},
			},
		});
		await flush();

		expect(client.sent).toHaveLength(0);
		expect(upstream.sent).toHaveLength(1);
		const forwarded = JSON.parse(upstream.sent[0]) as {
			session: {
				audio: { input: { transcription: { model: string } } };
			};
		};
		expect(forwarded.session.audio.input.transcription.model).toBe(
			"gpt-4o-mini-transcribe",
		);

		// Changing to another model afterwards is rejected.
		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { transcription: { model: "gpt-4o-transcribe" } } },
			},
		});
		await flush();
		expect(
			client.sent.some((m) => m.includes("transcription_model_locked")),
		).toBe(true);

		session.shutdown(1000, "test_done");
	});

	it("drains a disconnect until the pending transcription is billed", async () => {
		const { client, upstream, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				turn_detection: null,
				audio: {
					input: {
						transcription: { model: "gpt-4o-mini-transcribe" },
					},
				},
			},
		});
		await flush();

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();

		client.emit("close");
		await flush();

		// Still draining: the transcription's billable terminal event is pending.
		expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();
		expect(upstream.readyState).toBe(1);

		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_1",
			content_index: 0,
			transcript: "hello there",
			usage: {
				type: "tokens",
				total_tokens: 30,
				input_tokens: 20,
				output_tokens: 10,
				input_token_details: { text_tokens: 2, audio_tokens: 18 },
			},
		});
		await flush();

		expect(recordRealtimeTranscription).toHaveBeenCalledTimes(1);
		expect(recordRealtimeTranscription).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: "item_1",
				contentIndex: 0,
				sessionId: "rts_1",
			}),
		);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});

	it("still bills a pending transcription after transcription is disabled", async () => {
		const { upstream, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				turn_detection: null,
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
				},
			},
		});
		await flush();

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();

		// Transcription is turned off while item_1's transcription is still pending.
		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { transcription: null } },
			},
		});
		await flush();

		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_1",
			content_index: 0,
			transcript: "hello there",
			usage: {
				type: "tokens",
				total_tokens: 30,
				input_tokens: 20,
				output_tokens: 10,
				input_token_details: { text_tokens: 2, audio_tokens: 18 },
			},
		});
		await flush();

		// The pinned mapping survived the disable, so the tail event is billed
		// instead of killing the session as unbillable.
		expect(recordRealtimeTranscription).toHaveBeenCalledTimes(1);
		expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();

		// Items committed after the disable are no longer billable transcriptions,
		// so they must not hold a disconnect open.
		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_2" });
		await flush();
		expect(upstream.readyState).toBe(1);

		session.shutdown(1000, "test_done");
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"test_done",
			expect.anything(),
		);
	});

	it("does not start an auto-response while draining a disconnect", async () => {
		const { client, upstream, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				turn_detection: null,
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
				},
			},
		});
		await flush();

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();

		// Auto-response is on again, then the client vanishes while item_1's
		// transcription is still pending, so the session drains.
		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { turn_detection: { type: "server_vad" } } },
			},
		});
		await flush();
		client.emit("close");
		await flush();
		expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();

		// Server VAD commits residual audio mid-drain: no new billable generation
		// may start for a client that is already gone.
		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_2" });
		await flush();
		expect(
			upstream.sent.filter((m) => m.includes('"response.create"')),
		).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("does not pin transcription when a later field of the same update is rejected", async () => {
		const { client, upstream, session, clientSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
				},
				prompt: { id: "pmpt_123" },
			},
		});
		await flush();

		expect(client.sent.some((m) => m.includes("prompt_not_supported"))).toBe(
			true,
		);
		expect(upstream.sent).toHaveLength(0);

		// The rejected update was never forwarded, so it must not have pinned an
		// ASR mapping: a different model is still accepted afterwards.
		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: { input: { transcription: { model: "gpt-4o-transcribe" } } },
			},
		});
		await flush();

		expect(
			client.sent.some((m) => m.includes("transcription_model_locked")),
		).toBe(false);
		expect(upstream.sent).toHaveLength(1);

		session.shutdown(1000, "test_done");
	});

	it("does not track commits as pending when the enabling update was rejected", async () => {
		const { client, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: { type: "realtime", turn_detection: null },
		});
		await flush();

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
				},
				prompt: { id: "pmpt_123" },
			},
		});
		await flush();

		// Transcription was never enabled upstream, so the commit produces no
		// billable transcription event and must not hold a disconnect open.
		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();
		client.emit("close");
		await flush();

		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});

	it("closes the session when the API key is revoked between transcriptions", async () => {
		const { client, session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				turn_detection: null,
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
				},
			},
		});
		await flush();

		vi.mocked(findApiKeyByToken).mockResolvedValueOnce({
			id: "key_1",
			status: "revoked",
			createdBy: "user_1",
		} as unknown as Awaited<ReturnType<typeof findApiKeyByToken>>);
		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_1",
			content_index: 0,
			transcript: "hello there",
			usage: {
				type: "tokens",
				total_tokens: 30,
				input_tokens: 20,
				output_tokens: 10,
				input_token_details: { text_tokens: 2, audio_tokens: 18 },
			},
		});
		await flush();

		// The transcription itself is still billed, but the session is closed so a
		// revoked key cannot keep producing billable transcriptions.
		expect(recordRealtimeTranscription).toHaveBeenCalledTimes(1);
		expect(client.sent.some((m) => m.includes("api_key_revoked"))).toBe(true);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"api_key_revoked",
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});

	it("fails closed on duration-based transcription usage", async () => {
		const { session, clientSends, upstreamSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: {
				type: "realtime",
				turn_detection: null,
				audio: {
					input: { transcription: { model: "gpt-4o-mini-transcribe" } },
				},
			},
		});
		await flush();

		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_1",
			content_index: 0,
			transcript: "hello",
			usage: { type: "duration", seconds: 3.2 },
		});
		await flush();

		expect(recordRealtimeTranscription).not.toHaveBeenCalled();
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"error",
			expect.stringContaining("unpriceable_transcription"),
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});
});

describe("RealtimeProxySession transcription sessions", () => {
	const transcriptionMatch = {
		modelId: "gpt-live-transcribe",
		modelDef: { id: "gpt-live-transcribe" },
		mapping: {
			providerId: "openai",
			externalId: "gpt-live-transcribe",
			inputPrice: "0",
			outputPrice: "0",
			inputAudioHourPrice: "1.02",
		},
	} as unknown as RealtimeMappingMatch;

	function createTranscriptionSession() {
		return createSession(
			{
				sessionType: "transcription",
				match: transcriptionMatch,
				allowedTranscriptionModelIds: ["gpt-live-transcribe"],
			},
			transcriptionMatch,
		);
	}

	it("pins the transcription model upstream on session.created and hides the echo", async () => {
		const { client, upstream, session, upstreamSends } =
			createTranscriptionSession();

		upstreamSends({
			type: "session.created",
			session: { id: "sess_1", type: "transcription" },
		});
		upstreamSends({
			type: "session.updated",
			session: { id: "sess_1", type: "transcription" },
		});
		await flush();

		expect(upstream.sent).toHaveLength(1);
		const control = JSON.parse(upstream.sent[0]) as {
			type: string;
			event_id: string;
			session: {
				type: string;
				audio: { input: { transcription: { model: string } } };
			};
		};
		expect(control.type).toBe("session.update");
		expect(control.event_id).toBe("event_lmg_pin_transcription_model");
		expect(control.session.type).toBe("transcription");
		expect(control.session.audio.input.transcription.model).toBe(
			"gpt-live-transcribe",
		);
		// The control echo is suppressed; the created event is forwarded without
		// a realtime session model stamped onto it.
		expect(client.sent).toHaveLength(1);
		const created = JSON.parse(client.sent[0]) as {
			type: string;
			session: { model?: string };
		};
		expect(created.type).toBe("session.created");
		expect(created.session.model).toBeUndefined();

		session.shutdown(1000, "test_done");
	});

	it("rejects response.create", async () => {
		const { client, upstream, session, clientSends } = await openSession(
			createTranscriptionSession(),
		);

		clientSends({ type: "response.create" });
		await flush();

		expect(upstream.sent).toHaveLength(0);
		expect(client.sent.some((m) => m.includes("response_not_supported"))).toBe(
			true,
		);

		session.shutdown(1000, "test_done");
	});

	it("does not start a response for committed audio", async () => {
		const { upstream, session, upstreamSends } = await openSession(
			createTranscriptionSession(),
		);

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		await flush();

		expect(upstream.sent.some((m) => m.includes("response.create"))).toBe(
			false,
		);

		session.shutdown(1000, "test_done");
	});

	it("bills duration usage against the per-hour audio price", async () => {
		const { client, session, upstreamSends } = await openSession(
			createTranscriptionSession(),
		);

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_1",
			content_index: 0,
			transcript: "hello",
			usage: { type: "duration", seconds: 90 },
		});
		await flush();

		expect(recordRealtimeTranscription).toHaveBeenCalledTimes(1);
		const input = vi.mocked(recordRealtimeTranscription).mock.calls[0][0];
		expect(input.transcription.modelId).toBe("gpt-live-transcribe");
		expect(input.usage.inputAudioSeconds).toBe(90);
		expect(input.costs.totalCost.toString()).toBe("0.0255");
		expect(input.pricingSnapshot.audioInputHour).toBe("1.02");
		expect(
			client.sent.some((m) =>
				m.includes("input_audio_transcription.completed"),
			),
		).toBe(true);

		session.shutdown(1000, "test_done");
	});

	it("keeps the transcription model locked and forwards other config", async () => {
		const { client, upstream, session, clientSends } = await openSession(
			createTranscriptionSession(),
		);

		clientSends({
			type: "session.update",
			session: {
				type: "transcription",
				audio: { input: { transcription: null } },
			},
		});
		clientSends({
			type: "session.update",
			session: {
				type: "transcription",
				audio: { input: { transcription: { model: "gpt-4o-transcribe" } } },
			},
		});
		await flush();
		expect(
			client.sent.some((m) => m.includes("transcription_model_required")),
		).toBe(true);
		expect(
			client.sent.some((m) => m.includes("transcription_model_locked")),
		).toBe(true);
		expect(upstream.sent).toHaveLength(0);

		clientSends({
			type: "session.update",
			session: {
				type: "transcription",
				audio: {
					input: {
						transcription: {
							model: "openai/gpt-live-transcribe",
							delay: "low",
						},
						turn_detection: null,
					},
				},
			},
		});
		await flush();
		expect(upstream.sent).toHaveLength(1);
		const forwarded = JSON.parse(upstream.sent[0]) as {
			session: {
				audio: {
					input: {
						transcription: { model: string; delay: string };
						turn_detection: null;
					};
				};
			};
		};
		expect(forwarded.session.audio.input.transcription).toEqual({
			model: "gpt-live-transcribe",
			delay: "low",
		});
		expect(forwarded.session.audio.input.turn_detection).toBeNull();

		session.shutdown(1000, "test_done");
	});

	it("commits live-transcribed audio on disconnect and bills it before closing", async () => {
		const { client, upstream, session, upstreamSends } = await openSession(
			createTranscriptionSession(),
		);

		// Streaming ASR emits deltas for audio the client never committed.
		upstreamSends({
			type: "conversation.item.input_audio_transcription.delta",
			item_id: "item_live",
			delta: "Hello",
		});
		await flush();
		client.emit("close");
		await flush();

		// The gateway commits the live buffer and keeps the upstream open.
		expect(
			upstream.sent.some((m) => m.includes("input_audio_buffer.commit")),
		).toBe(true);
		expect(upstream.closed).toHaveLength(0);
		expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();

		upstreamSends({
			type: "input_audio_buffer.committed",
			item_id: "item_live",
		});
		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_live",
			content_index: 0,
			transcript: "Hello",
			usage: { type: "duration", seconds: 2 },
		});
		await flush();

		expect(recordRealtimeTranscription).toHaveBeenCalledTimes(1);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});

	it("drains live-transcribed audio when the client stops answering pings", async () => {
		process.env.REALTIME_PING_INTERVAL_MS = "10";
		try {
			const { client, upstream, session, upstreamSends } = await openSession(
				createTranscriptionSession(),
			);

			upstreamSends({
				type: "conversation.item.input_audio_transcription.delta",
				item_id: "item_live",
				delta: "Hello",
			});
			await flush();
			// The upstream keeps answering pings; the client never does.
			const keepUpstreamAlive = setInterval(() => upstream.emit("pong"), 2);
			try {
				await new Promise((resolve) => setTimeout(resolve, 40));
				await flush();
			} finally {
				clearInterval(keepUpstreamAlive);
			}

			// The client is closed for the ping timeout, but the live buffer is
			// committed and the upstream stays open for its billable tail.
			expect(client.closed).toEqual([{ code: 1011, reason: "ping_timeout" }]);
			expect(
				upstream.sent.some((m) => m.includes("input_audio_buffer.commit")),
			).toBe(true);
			expect(upstream.closed).toHaveLength(0);
			expect(closeRealtimeSessionRecord).not.toHaveBeenCalled();

			upstreamSends({
				type: "input_audio_buffer.committed",
				item_id: "item_live",
			});
			upstreamSends({
				type: "conversation.item.input_audio_transcription.completed",
				item_id: "item_live",
				content_index: 0,
				transcript: "Hello",
				usage: { type: "duration", seconds: 2 },
			});
			await flush();

			expect(recordRealtimeTranscription).toHaveBeenCalledTimes(1);
			expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
				"rts_1",
				"closed",
				"ping_timeout",
				expect.anything(),
			);

			session.shutdown(1000, "test_done");
		} finally {
			delete process.env.REALTIME_PING_INTERVAL_MS;
		}
	});

	it("commits live-transcribed audio ahead of a client clear", async () => {
		const { upstream, session, clientSends, upstreamSends } = await openSession(
			createTranscriptionSession(),
		);

		upstreamSends({
			type: "conversation.item.input_audio_transcription.delta",
			item_id: "item_live",
			delta: "Hello",
		});
		await flush();
		clientSends({ type: "input_audio_buffer.clear" });
		await flush();

		expect(upstream.sent.map((m) => JSON.parse(m).type)).toEqual([
			"input_audio_buffer.commit",
			"input_audio_buffer.clear",
		]);

		// A clear with nothing live is forwarded as is.
		upstreamSends({
			type: "input_audio_buffer.committed",
			item_id: "item_live",
		});
		upstream.sent.length = 0;
		clientSends({ type: "input_audio_buffer.clear" });
		await flush();
		expect(upstream.sent.map((m) => JSON.parse(m).type)).toEqual([
			"input_audio_buffer.clear",
		]);

		session.shutdown(1000, "test_done");
	});

	it("closes the session when the provider rate limit is exhausted", async () => {
		vi.mocked(checkProviderRateLimit).mockResolvedValueOnce({
			allowed: false,
			rateLimited: true,
			blockedBy: ["rpm"],
			retryAfter: 30,
		} as unknown as Awaited<ReturnType<typeof checkProviderRateLimit>>);
		const { client, session, upstreamSends } = await openSession(
			createTranscriptionSession(),
		);

		upstreamSends({ type: "input_audio_buffer.committed", item_id: "item_1" });
		upstreamSends({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "item_1",
			content_index: 0,
			transcript: "hello",
			usage: { type: "duration", seconds: 4 },
		});
		await flush();

		expect(checkProviderRateLimit).toHaveBeenCalledWith(
			"org_1",
			"openai",
			"gpt-live-transcribe",
		);
		expect(client.sent.some((m) => m.includes("rate_limit_exceeded"))).toBe(
			true,
		);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"closed",
			"rate_limit_exceeded",
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});

	it("closes the session when the upstream rejects the model pin", async () => {
		const { session, upstreamSends } = await openSession(
			createTranscriptionSession(),
		);

		upstreamSends({
			type: "error",
			error: {
				type: "invalid_request_error",
				event_id: "event_lmg_pin_transcription_model",
				message: "Unsupported model",
			},
		});
		await flush();

		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_1",
			"error",
			"transcription_pin_rejected",
			expect.anything(),
		);

		session.shutdown(1000, "test_done");
	});
});

describe("RealtimeProxySession pinned instructions", () => {
	const INSTRUCTIONS = "You are the operator's support agent.";

	it("applies pinned instructions and voice in the control session.update", async () => {
		const { upstream, session, upstreamSends } = createSession({}, null, {
			instructions: INSTRUCTIONS,
			voice: "marin",
		});

		upstreamSends({ type: "session.created", session: { id: "sess_1" } });
		await flush();

		const control = JSON.parse(upstream.sent[0]) as {
			session: {
				instructions: string;
				audio: {
					input: { turn_detection: { create_response: boolean } };
					output: { voice: string };
				};
			};
		};
		expect(control.session.instructions).toBe(INSTRUCTIONS);
		expect(control.session.audio.output.voice).toBe("marin");
		// The auto-response control this message already carried still applies.
		expect(control.session.audio.input.turn_detection.create_response).toBe(
			false,
		);

		session.shutdown(1000, "test_done");
	});

	it("omits instructions from the control update when nothing is pinned", async () => {
		const { upstream, session, upstreamSends } = createSession();

		upstreamSends({ type: "session.created", session: { id: "sess_1" } });
		await flush();

		const control = JSON.parse(upstream.sent[0]) as {
			session: Record<string, unknown>;
		};
		expect(control.session).not.toHaveProperty("instructions");
		expect(control.session.audio).not.toHaveProperty("output");

		session.shutdown(1000, "test_done");
	});

	it("rejects a client session.update that changes instructions", async () => {
		const { client, upstream, session, clientSends } = await openSession(
			createSession({}, null, {
				instructions: INSTRUCTIONS,
			}),
		);

		clientSends({
			type: "session.update",
			session: { type: "realtime", instructions: "You are a pirate." },
		});
		await flush();

		expect(client.sent.some((m) => m.includes("instructions_locked"))).toBe(
			true,
		);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("rejects per-response instructions that would bypass the lock", async () => {
		const { client, upstream, session, clientSends } = await openSession(
			createSession({}, null, { instructions: INSTRUCTIONS }),
		);

		clientSends({
			type: "response.create",
			response: { instructions: "You are a pirate." },
		});
		await flush();

		expect(client.sent.some((m) => m.includes("instructions_locked"))).toBe(
			true,
		);
		expect(upstream.sent).toHaveLength(0);

		session.shutdown(1000, "test_done");
	});

	it("allows unrelated session updates while instructions are pinned", async () => {
		const { client, upstream, session, clientSends } = await openSession(
			createSession({}, null, {
				instructions: INSTRUCTIONS,
			}),
		);

		clientSends({
			type: "session.update",
			session: { type: "realtime", audio: { output: { voice: "cedar" } } },
		});
		await flush();

		expect(client.sent).toHaveLength(0);
		expect(upstream.sent).toHaveLength(1);

		session.shutdown(1000, "test_done");
	});

	it("leaves instructions to the client when nothing is pinned", async () => {
		const { client, upstream, session, clientSends } =
			await openSession(createSession());

		clientSends({
			type: "session.update",
			session: { type: "realtime", instructions: "client owns this" },
		});
		await flush();

		expect(client.sent).toHaveLength(0);
		expect(upstream.sent).toHaveLength(1);
		expect(upstream.sent[0]).toContain("client owns this");

		session.shutdown(1000, "test_done");
	});

	it("holds generation until the pinned instructions reach the provider", async () => {
		// A client that does not wait for session.created must not be able to
		// generate a turn under the provider's defaults.
		const { upstream, session, clientSends, upstreamSends } = createSession(
			{},
			null,
			{ instructions: INSTRUCTIONS },
		);

		clientSends({ type: "response.create" });
		await flush();
		expect(upstream.sent).toHaveLength(0);

		upstreamSends({ type: "session.created", session: { id: "sess_1" } });
		await flush();

		expect(upstream.sent).toHaveLength(2);
		expect(upstream.sent[0]).toContain(INSTRUCTIONS);
		expect(JSON.parse(upstream.sent[1]).type).toBe("response.create");

		session.shutdown(1000, "test_done");
	});

	it("keeps an early client voice update effective over the pinned default", async () => {
		// Real clients configure on socket open rather than on session.created, so
		// the client's own update must land after the gateway's control update —
		// voice is a default, not a lock.
		const { upstream, session, clientSends, upstreamSends } = createSession(
			{},
			null,
			{ instructions: INSTRUCTIONS, voice: "marin" },
		);

		clientSends({
			type: "session.update",
			session: { type: "realtime", audio: { output: { voice: "cedar" } } },
		});
		await flush();
		expect(upstream.sent).toHaveLength(0);

		upstreamSends({ type: "session.created", session: { id: "sess_1" } });
		await flush();

		expect(upstream.sent).toHaveLength(2);
		const control = JSON.parse(upstream.sent[0]) as {
			session: { instructions: string; audio: { output: { voice: string } } };
		};
		const clientUpdate = JSON.parse(upstream.sent[1]) as {
			session: { audio: { output: { voice: string } } };
		};
		expect(control.session.instructions).toBe(INSTRUCTIONS);
		expect(control.session.audio.output.voice).toBe("marin");
		// The client's choice is applied last, so it is the one in effect.
		expect(clientUpdate.session.audio.output.voice).toBe("cedar");

		session.shutdown(1000, "test_done");
	});

	it("strips pinned instructions from session events echoed to the client", async () => {
		const { client, session, upstreamSends } = createSession({}, null, {
			instructions: INSTRUCTIONS,
		});

		// The provider echoes the whole session state, instructions included.
		upstreamSends({
			type: "session.updated",
			session: { id: "sess_1", instructions: INSTRUCTIONS },
		});
		await flush();

		expect(client.sent.join("")).not.toContain(INSTRUCTIONS);

		session.shutdown(1000, "test_done");
	});
});
