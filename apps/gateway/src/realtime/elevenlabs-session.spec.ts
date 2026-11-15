import { EventEmitter } from "node:events";

import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import { authorizeAccount, availableCredits } from "./account-gate.js";
import {
	closeRealtimeSessionRecord,
	markRealtimeSessionUpstream,
	recordRealtimeTranscription,
} from "./billing.js";
import { ElevenLabsRealtimeProxySession } from "./elevenlabs-session.js";
import { RealtimeConnectError } from "./errors.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { WebSocket } from "ws";

vi.mock("./account-gate.js", () => ({
	authorizeAccount: vi.fn(async () => ({ ok: true, organization: {} })),
	availableCredits: vi.fn(async () => new Decimal(10)),
}));

vi.mock("@/lib/provider-rate-limit.js", () => ({
	checkProviderRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@llmgateway/db", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getEffectiveDiscount: vi.fn(async () => ({ discount: 0 })),
}));

vi.mock("./billing.js", () => ({
	closeRealtimeSessionRecord: vi.fn(async () => {}),
	markRealtimeSessionUpstream: vi.fn(async () => {}),
	recordRealtimeTranscription: vi.fn(async () => ({ inserted: true })),
}));

vi.mock("./leases.js", () => ({
	LEASE_HEARTBEAT_INTERVAL_MS: 30_000,
	releaseRealtimeLease: vi.fn(async () => {}),
	renewRealtimeLease: vi.fn(async () => {}),
}));

vi.mock("./turn-denial-log.js", () => ({
	logRealtimeTurnDenial: vi.fn(async () => {}),
}));

class FakeSocket extends EventEmitter {
	public readyState = 1;
	public sent: string[] = [];
	public closed: Array<{ code: number; reason?: string }> = [];
	public paused = false;

	public send(text: string): void {
		this.sent.push(text);
	}

	public ping(): void {}

	public pause(): void {
		this.paused = true;
	}

	public resume(): void {
		this.paused = false;
	}

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

const preflight = {
	apiKey: { id: "key_1" },
	project: { id: "proj_1", organizationId: "org_1", mode: "credits" },
	sessionType: "transcription",
	match: {
		modelId: "scribe-v3-live",
		modelDef: { id: "scribe-v3-live" },
		mapping: {
			providerId: "elevenlabs",
			externalId: "scribe_v3_live",
			inputPrice: "0",
			outputPrice: "0",
			inputAudioHourPrice: "0.22",
			requestPrice: "0",
		},
	},
	usedMode: "credits",
} as unknown as RealtimePreflightResult;

/** Bytes of PCM16 at the default 24 kHz. */
const SECOND = 48_000;

async function flush(): Promise<void> {
	for (let i = 0; i < 30; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

function createSession(
	connectImpl?: (query: URLSearchParams) => Promise<WebSocket>,
) {
	const client = new FakeSocket();
	const upstreams: FakeSocket[] = [];
	const queries: URLSearchParams[] = [];
	const connectUpstream = vi.fn(
		connectImpl ??
			(async (query: URLSearchParams) => {
				queries.push(query);
				const upstream = new FakeSocket();
				upstream.paused = true;
				upstreams.push(upstream);
				return upstream as unknown as WebSocket;
			}),
	);
	const session = new ElevenLabsRealtimeProxySession({
		clientSocket: client as unknown as WebSocket,
		connectUpstream,
		extensionQuery: new URLSearchParams(),
		preflight,
		gatewayToken: "llmgtwy_test",
		requestedModel: "scribe-v3-live",
		sessionRecordId: "rts_e1",
		lease: { sessionId: "rts_e1", organizationId: "org_1", apiKeyId: "key_1" },
		source: null,
		userAgent: "vitest",
		onClosed: () => {},
	});
	const clientSends = (message: unknown, isBinary = false) => {
		client.emit("message", Buffer.from(JSON.stringify(message)), isBinary);
	};
	const upstream = () => upstreams.at(-1)!;
	const upstreamSends = (message: Record<string, unknown>) => {
		upstream().emit("message", Buffer.from(JSON.stringify(message)));
	};
	const append = (bytes: number) =>
		clientSends({
			type: "input_audio_buffer.append",
			audio: Buffer.alloc(bytes).toString("base64"),
		});
	const update = (input: Record<string, unknown>) =>
		clientSends({
			type: "session.update",
			session: { type: "transcription", audio: { input } },
		});
	const events = () =>
		client.sent.map(
			(text) => JSON.parse(text) as Record<string, unknown> & { type: string },
		);
	const eventTypes = () => events().map((event) => event.type);
	const upstreamSent = () =>
		upstream().sent.map((text) => JSON.parse(text) as Record<string, unknown>);
	return {
		client,
		upstreams,
		queries,
		connectUpstream,
		session,
		clientSends,
		upstream,
		upstreamSends,
		append,
		update,
		events,
		eventTypes,
		upstreamSent,
	};
}

function billedSeconds(): number[] {
	return vi
		.mocked(recordRealtimeTranscription)
		.mock.calls.map(([input]) => input.usage.inputAudioSeconds);
}

describe("ElevenLabsRealtimeProxySession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens as an OpenAI transcription session without connecting upstream", () => {
		const { events, connectUpstream, session } = createSession();
		expect(events()).toEqual([
			expect.objectContaining({
				type: "session.created",
				event_id: expect.any(String),
				session: expect.objectContaining({
					type: "transcription",
					object: "realtime.transcription_session",
					audio: {
						input: {
							format: { type: "audio/pcm", rate: 24_000 },
							noise_reduction: null,
							transcription: {
								model: "elevenlabs/scribe-v3-live",
								language: null,
								prompt: "",
							},
							turn_detection: { type: "server_vad" },
						},
					},
				}),
			}),
		]);
		expect(connectUpstream).not.toHaveBeenCalled();
		session.shutdown(1000, "test");
	});

	it("applies session.update to the upstream it opens on the first audio", async () => {
		const { update, append, events, queries, upstreamSent, session } =
			createSession();
		update({
			format: { type: "audio/pcm", rate: 16_000 },
			transcription: {
				model: "scribe-v3-live",
				language: "en",
				prompt: "Acme",
			},
			turn_detection: { type: "server_vad", silence_duration_ms: 700 },
		});
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "session.updated",
			session: {
				audio: {
					input: {
						format: { type: "audio/pcm", rate: 16_000 },
						transcription: { language: "en", prompt: "Acme" },
						turn_detection: { type: "server_vad", silence_duration_ms: 700 },
					},
				},
			},
		});
		expect(queries).toEqual([]);

		append(3200);
		append(3200);
		await flush();
		expect(queries.map((query) => query.toString())).toEqual([
			"audio_format=pcm_16000&language_code=en&commit_strategy=vad&vad_silence_threshold_secs=0.7",
		]);
		expect(upstreamSent()).toEqual([
			{
				message_type: "input_audio_chunk",
				audio_base_64: Buffer.alloc(3200).toString("base64"),
				commit: false,
				sample_rate: 16_000,
				previous_text: "Acme",
			},
			{
				message_type: "input_audio_chunk",
				audio_base_64: Buffer.alloc(3200).toString("base64"),
				commit: false,
				sample_rate: 16_000,
			},
		]);
		session.shutdown(1000, "test");
	});

	it("translates server VAD transcripts and bills them before delivery", async () => {
		const { append, upstreamSends, events, eventTypes, upstream, session } =
			createSession();
		append(SECOND);
		append(SECOND / 2);
		await flush();
		expect(upstream().paused).toBe(false);
		upstreamSends({
			message_type: "session_started",
			session_id: "el_1",
			config: {},
		});
		upstreamSends({ message_type: "partial_transcript", text: "Hello," });
		// A revision of delivered text is not forwarded.
		upstreamSends({ message_type: "partial_transcript", text: "Hello world." });
		upstreamSends({
			message_type: "partial_transcript",
			text: "Hello, world.",
		});
		upstreamSends({
			message_type: "committed_transcript",
			text: "Hello, world!",
		});
		await flush();

		expect(markRealtimeSessionUpstream).toHaveBeenCalledWith("rts_e1", "el_1");
		expect(eventTypes()).toEqual([
			"session.created",
			"input_audio_buffer.speech_started",
			"conversation.item.input_audio_transcription.delta",
			"conversation.item.input_audio_transcription.delta",
			"input_audio_buffer.speech_stopped",
			"input_audio_buffer.committed",
			"conversation.item.input_audio_transcription.completed",
		]);
		const [, started, first, second, stopped, committed, completed] = events();
		const itemId = started!.item_id;
		expect(started).toMatchObject({ audio_start_ms: 0 });
		expect(first).toMatchObject({ item_id: itemId, delta: "Hello," });
		expect(second).toMatchObject({ item_id: itemId, delta: " world." });
		expect(stopped).toMatchObject({ item_id: itemId, audio_end_ms: 1500 });
		expect(committed).toMatchObject({
			item_id: itemId,
			previous_item_id: null,
		});
		expect(completed).toMatchObject({
			item_id: itemId,
			content_index: 0,
			transcript: "Hello, world!",
			usage: { type: "duration", seconds: 1.5 },
		});
		expect(billedSeconds()).toEqual([1.5]);
		const [input] = vi.mocked(recordRealtimeTranscription).mock.calls[0]!;
		expect(input.costs.totalCost.toString()).toBe(
			new Decimal("0.22").times(1.5).dividedBy(3600).toString(),
		);
		session.shutdown(1000, "test");
	});

	it("skips a silent upstream commit", async () => {
		const { append, upstreamSends, eventTypes, session } = createSession();
		append(SECOND);
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "" });
		await flush();
		expect(eventTypes()).toEqual(["session.created"]);
		session.shutdown(1000, "test");
	});

	it("commits manual turns on input_audio_buffer.commit", async () => {
		const {
			update,
			append,
			clientSends,
			upstreamSends,
			queries,
			upstreamSent,
			events,
			session,
		} = createSession();
		update({ turn_detection: null });
		append(SECOND);
		clientSends({ type: "input_audio_buffer.commit" });
		await flush();
		expect(queries[0]?.get("commit_strategy")).toBe("manual");
		expect(upstreamSent().at(-1)).toEqual({
			message_type: "input_audio_chunk",
			audio_base_64: "",
			commit: true,
			sample_rate: 24_000,
		});
		const committed = events().at(-1)!;
		expect(committed).toMatchObject({ type: "input_audio_buffer.committed" });

		upstreamSends({ message_type: "committed_transcript", text: "hi" });
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: committed.item_id,
			transcript: "hi",
			usage: { type: "duration", seconds: 1 },
		});
		expect(
			events().some((event) =>
				event.type.startsWith("input_audio_buffer.speech"),
			),
		).toBe(false);
		session.shutdown(1000, "test");
	});

	it("rejects a commit without audio", async () => {
		const { clientSends, events, session } = createSession();
		clientSends({ type: "input_audio_buffer.commit", event_id: "evt_1" });
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "error",
			error: {
				type: "invalid_request_error",
				code: "input_audio_buffer_commit_empty",
				event_id: "evt_1",
			},
		});
		session.shutdown(1000, "test");
	});

	it("fails a commit the upstream throttles", async () => {
		const { update, append, clientSends, upstreamSends, events, session } =
			createSession();
		update({ turn_detection: null });
		append(SECOND);
		clientSends({ type: "input_audio_buffer.commit" });
		await flush();
		const { item_id: itemId } = events().at(-1)!;
		upstreamSends({ message_type: "commit_throttled", error: "Too fast." });
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "conversation.item.input_audio_transcription.failed",
			item_id: itemId,
			error: { code: "commit_throttled", message: "Too fast." },
		});
		session.shutdown(1000, "test");
	});

	it.each([
		[
			"another transcription model",
			{ transcription: { model: "gpt-4o-transcribe" } },
			"transcription_model_locked",
		],
		[
			"disabled transcription",
			{ transcription: null },
			"transcription_model_required",
		],
		[
			"A-law audio",
			{ format: { type: "audio/pcma" } },
			"unsupported_audio_format",
		],
		[
			"keywords",
			{ transcription: { keywords: ["Acme"] } },
			"unsupported_parameter",
		],
	])("rejects a session.update with %s", async (_name, input, code) => {
		const { update, events, session } = createSession();
		update(input);
		await flush();
		expect(events().at(-1)).toMatchObject({ type: "error", error: { code } });
		session.shutdown(1000, "test");
	});

	it("accepts the legacy top-level session fields", async () => {
		const { clientSends, events, session } = createSession();
		clientSends({
			type: "session.update",
			session: {
				input_audio_format: "g711_ulaw",
				input_audio_transcription: { model: "elevenlabs/scribe-v3-live" },
				turn_detection: { type: "semantic_vad" },
			},
		});
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "session.updated",
			session: {
				audio: {
					input: {
						format: { type: "audio/pcmu" },
						turn_detection: { type: "semantic_vad" },
					},
				},
			},
		});
		session.shutdown(1000, "test");
	});

	it("reopens the upstream when its settings change between transcripts", async () => {
		const { update, append, upstreams, queries, eventTypes, session } =
			createSession();
		append(SECOND);
		await flush();
		update({ transcription: { language: "de" } });
		await flush();
		expect(upstreams[0]!.closed).toEqual([{ code: 1000, reason: undefined }]);
		expect(billedSeconds()).toEqual([1]);
		expect(eventTypes().at(-1)).toBe("session.updated");
		append(SECOND);
		await flush();
		expect(queries.map((query) => query.get("language_code"))).toEqual([
			null,
			"de",
		]);
		session.shutdown(1000, "test");
	});

	it("refuses a settings change while a transcript is in progress", async () => {
		const { update, append, upstreamSends, events, session } = createSession();
		append(SECOND);
		await flush();
		upstreamSends({ message_type: "partial_transcript", text: "hel" });
		update({ transcription: { language: "de" } });
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "error",
			error: { code: "session_update_in_progress" },
		});
		session.shutdown(1000, "test");
	});

	it("clears uncommitted audio by reopening the upstream", async () => {
		const { append, clientSends, upstreams, eventTypes, session } =
			createSession();
		append(SECOND);
		await flush();
		clientSends({ type: "input_audio_buffer.clear" });
		await flush();
		expect(upstreams[0]!.closed).toHaveLength(1);
		expect(eventTypes().at(-1)).toBe("input_audio_buffer.cleared");
		append(SECOND);
		await flush();
		expect(upstreams).toHaveLength(2);
		session.shutdown(1000, "test");
	});

	it("reopens an upstream that closed and fails its pending commits", async () => {
		const {
			update,
			append,
			clientSends,
			upstream,
			upstreams,
			events,
			client,
			session,
		} = createSession();
		update({ turn_detection: null });
		append(SECOND);
		clientSends({ type: "input_audio_buffer.commit" });
		await flush();
		upstream().emit("close", 1006, Buffer.from(""));
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "conversation.item.input_audio_transcription.failed",
			error: { code: "upstream_closed" },
		});
		expect(billedSeconds()).toEqual([1]);
		expect(client.closed).toEqual([]);
		append(SECOND);
		await flush();
		expect(upstreams).toHaveLength(2);
		session.shutdown(1000, "test");
	});

	it("completes an open item when an idle upstream closes", async () => {
		const {
			append,
			upstream,
			upstreamSends,
			eventTypes,
			events,
			client,
			session,
		} = createSession();
		append(SECOND);
		await flush();
		upstreamSends({ message_type: "partial_transcript", text: "hi there" });
		upstream().emit("close", 1000, Buffer.from(""));
		await flush();
		expect(eventTypes().slice(-3)).toEqual([
			"input_audio_buffer.speech_stopped",
			"input_audio_buffer.committed",
			"conversation.item.input_audio_transcription.completed",
		]);
		expect(events().at(-1)).toMatchObject({ transcript: "hi there" });
		expect(billedSeconds()).toEqual([1]);
		expect(client.closed).toEqual([]);
		session.shutdown(1000, "test");
	});

	it("ends the session when the upstream keeps failing", async () => {
		const { append, upstream, client } = createSession();
		for (let i = 0; i < 4; i++) {
			append(SECOND);
			await flush();
			upstream().emit("close", 1006, Buffer.from(""));
			await flush();
		}
		expect(client.closed[0]?.code).toBe(1011);
	});

	it("closes the session after a fatal upstream error", async () => {
		const { append, upstream, upstreamSends, events, client } = createSession();
		append(SECOND);
		await flush();
		upstreamSends({ message_type: "quota_exceeded", error: "No quota." });
		upstream().emit("close", 1008, Buffer.from("quota"));
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "error",
			error: { type: "server_error", code: "quota_exceeded" },
		});
		expect(client.closed[0]?.code).toBe(1011);
	});

	it("closes the session when the upstream cannot connect", async () => {
		const { append, events, client } = createSession(async () => {
			throw new RealtimeConnectError(
				502,
				"upstream_connect_failed",
				"Upstream provider rejected the realtime connection (status 401).",
			);
		});
		append(SECOND);
		await flush();
		expect(events().at(-1)).toMatchObject({
			type: "error",
			error: { code: "upstream_connect_failed" },
		});
		expect(client.closed[0]).toEqual({
			code: 1011,
			reason: "upstream_connect_failed",
		});
		expect(recordRealtimeTranscription).not.toHaveBeenCalled();
	});

	it("rejects response.create", async () => {
		const { clientSends, events, session } = createSession();
		clientSends({ type: "response.create" });
		await flush();
		expect(events().at(-1)).toMatchObject({
			error: { code: "response_not_supported" },
		});
		session.shutdown(1000, "test");
	});

	it("bills long uncommitted streams periodically", async () => {
		const { append, session } = createSession();
		for (let i = 0; i < 31; i++) {
			append(SECOND);
		}
		await flush();
		expect(billedSeconds()).toEqual([30]);
		session.shutdown(1000, "test");
	});

	it("bills the uncommitted tail when the client disconnects", async () => {
		const { client, upstream, append } = createSession();
		append(SECOND / 4);
		await flush();
		client.emit("close");
		await flush();
		expect(billedSeconds()).toEqual([0.25]);
		expect(upstream().closed).toEqual([{ code: 1000, reason: undefined }]);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_e1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);
	});

	it("refuses audio when the account no longer clears the gates", async () => {
		vi.mocked(authorizeAccount).mockResolvedValueOnce({
			ok: false,
			code: "insufficient_credits",
			message: "No credits.",
			severity: "deny",
		} as Awaited<ReturnType<typeof authorizeAccount>>);
		const { client, connectUpstream, append } = createSession();
		append(3200);
		await flush();
		expect(connectUpstream).not.toHaveBeenCalled();
		expect(client.closed[0]?.code).toBe(1008);
	});

	it("does not deliver a transcript it could not bill", async () => {
		vi.mocked(recordRealtimeTranscription).mockRejectedValueOnce(
			new Error("db down"),
		);
		const { client, append, upstreamSends, eventTypes } = createSession();
		append(SECOND);
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "hello" });
		await flush();
		expect(eventTypes()).not.toContain(
			"conversation.item.input_audio_transcription.completed",
		);
		expect(client.closed[0]).toEqual({
			code: 1011,
			reason: "billing_unavailable",
		});
	});

	it("counts one provider request and reauthorizes after each charge", async () => {
		const { append, upstreamSends, session } = createSession();
		append(4800);
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "a" });
		await flush();
		append(4800);
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "b" });
		await flush();
		expect(checkProviderRateLimit).toHaveBeenCalledTimes(1);
		expect(authorizeAccount).toHaveBeenCalledTimes(2);
		expect(availableCredits).toHaveBeenCalledTimes(2);
		expect(billedSeconds()).toEqual([0.1, 0.1]);
		session.shutdown(1000, "test");
	});

	it("checks credits before connecting", async () => {
		vi.mocked(availableCredits).mockResolvedValueOnce(new Decimal(0));
		const { client, connectUpstream, append, events } = createSession();
		append(3200);
		await flush();
		expect(connectUpstream).not.toHaveBeenCalled();
		expect(events().at(-1)).toMatchObject({
			error: { code: "insufficient_credits" },
		});
		expect(client.closed[0]?.code).toBe(1008);
		expect(recordRealtimeTranscription).not.toHaveBeenCalled();
	});

	it("reopens an upstream that is closing before its close event", async () => {
		const { client, upstream, upstreams, append } = createSession();
		append(SECOND);
		await flush();
		upstream().readyState = 2;
		append(SECOND);
		await flush();
		expect(upstreams).toHaveLength(2);
		expect(upstreams[1]!.sent).toHaveLength(1);
		upstreams[0]!.emit("close", 1000, Buffer.from(""));
		client.emit("close");
		await flush();
		expect(billedSeconds()).toEqual([1, 1]);
	});

	it("pauses the client while too many frames are queued", async () => {
		let release!: () => void;
		vi.mocked(authorizeAccount).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () =>
						resolve({ ok: true, organization: {} } as Awaited<
							ReturnType<typeof authorizeAccount>
						>);
				}),
		);
		const { client, append, session } = createSession();
		for (let i = 0; i < 4; i++) {
			append(1024 * 1024);
		}
		expect(client.paused).toBe(true);
		await flush();
		release();
		await flush();
		expect(client.paused).toBe(false);
		session.shutdown(1000, "test");
	});

	it("reauthorizes once the cached authorization expires", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			const { append, session } = createSession();
			append(480);
			await flush();
			append(480);
			await flush();
			expect(authorizeAccount).toHaveBeenCalledTimes(1);
			vi.setSystemTime(Date.now() + 5001);
			append(480);
			await flush();
			expect(authorizeAccount).toHaveBeenCalledTimes(2);
			session.shutdown(1000, "test");
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses audio without closing when the balance is unreadable", async () => {
		vi.mocked(availableCredits).mockResolvedValueOnce(null);
		const { client, upstreams, append, events, session } = createSession();
		append(480);
		await flush();
		expect(upstreams).toHaveLength(0);
		expect(events().at(-1)).toMatchObject({
			error: { code: "gate_unavailable" },
		});
		expect(client.closed).toEqual([]);
		append(480);
		await flush();
		expect(upstreams[0]?.sent).toHaveLength(1);
		session.shutdown(1000, "test");
	});

	it("does not cache an authorization a charge overtook", async () => {
		let release!: () => void;
		const { append, upstreamSends, session } = createSession();
		append(4800);
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "a" });
		await flush();
		vi.mocked(availableCredits).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve(new Decimal(10));
				}),
		);
		append(4800);
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "b" });
		await flush();
		release();
		await flush();
		const calls = vi.mocked(authorizeAccount).mock.calls.length;
		append(4800);
		await flush();
		expect(vi.mocked(authorizeAccount).mock.calls.length).toBe(calls + 1);
		session.shutdown(1000, "test");
	});
});
