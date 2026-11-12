import { EventEmitter } from "node:events";

import { Decimal } from "decimal.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import { authorizeAccount, availableCredits } from "./account-gate.js";
import {
	closeRealtimeSessionRecord,
	recordRealtimeTranscription,
} from "./billing.js";
import { ElevenLabsRealtimeProxySession } from "./elevenlabs-session.js";

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

	public send(text: string): void {
		this.sent.push(text);
	}

	public ping(): void {}

	public paused = false;

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

async function flush(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

function createSession() {
	const client = new FakeSocket();
	const upstream = new FakeSocket();
	const session = new ElevenLabsRealtimeProxySession({
		clientSocket: client as unknown as WebSocket,
		upstreamSocket: upstream as unknown as WebSocket,
		preflight,
		config: {
			query: new URLSearchParams(),
			sampleRate: 16_000,
			bytesPerSecond: 32_000,
		},
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
	const upstreamSends = (message: Record<string, unknown>) => {
		upstream.emit("message", Buffer.from(JSON.stringify(message)));
	};
	const chunk = (bytes: number, extra: Record<string, unknown> = {}) => ({
		message_type: "input_audio_chunk",
		audio_base_64: Buffer.alloc(bytes).toString("base64"),
		sample_rate: 16_000,
		...extra,
	});
	const clientMessages = () =>
		client.sent.map((text) => JSON.parse(text) as Record<string, unknown>);
	return {
		client,
		upstream,
		session,
		clientSends,
		upstreamSends,
		chunk,
		clientMessages,
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

	it("forwards audio chunks and bills them before the committed transcript", async () => {
		const {
			upstream,
			clientSends,
			upstreamSends,
			chunk,
			clientMessages,
			session,
		} = createSession();

		clientSends(chunk(32_000));
		clientSends(chunk(16_000, { commit: true }));
		await flush();
		expect(upstream.sent.map((text) => JSON.parse(text))).toEqual([
			expect.objectContaining({ sample_rate: 16_000, commit: false }),
			expect.objectContaining({ sample_rate: 16_000, commit: true }),
		]);
		expect(recordRealtimeTranscription).not.toHaveBeenCalled();

		upstreamSends({ message_type: "partial_transcript", text: "hel" });
		upstreamSends({ message_type: "committed_transcript", text: "hello" });
		await flush();

		expect(billedSeconds()).toEqual([1.5]);
		const [input] = vi.mocked(recordRealtimeTranscription).mock.calls[0]!;
		expect(input.itemId).toBe("audio-1");
		expect(input.costs.totalCost.toString()).toBe(
			new Decimal("0.22").times(1.5).dividedBy(3600).toString(),
		);
		expect(clientMessages().map((m) => m.message_type)).toEqual([
			"partial_transcript",
			"committed_transcript",
		]);
		session.shutdown(1000, "test");
	});

	it("bills long uncommitted streams periodically", async () => {
		const { clientSends, chunk, session } = createSession();
		for (let i = 0; i < 31; i++) {
			clientSends(chunk(32_000));
		}
		await flush();
		expect(billedSeconds()).toEqual([30]);
		session.shutdown(1000, "test");
	});

	it("bills the uncommitted tail when the client disconnects", async () => {
		const { client, upstream, clientSends, chunk } = createSession();
		clientSends(chunk(8000));
		client.emit("close");
		await flush();
		expect(billedSeconds()).toEqual([0.25]);
		expect(upstream.closed).toEqual([{ code: 1000, reason: undefined }]);
		expect(closeRealtimeSessionRecord).toHaveBeenCalledWith(
			"rts_e1",
			"closed",
			"client_disconnected",
			expect.anything(),
		);
	});

	it.each([
		["a non-chunk message", { message_type: "commit" }, false],
		["a binary frame", { message_type: "input_audio_chunk" }, true],
		[
			"an unknown chunk field",
			{
				message_type: "input_audio_chunk",
				audio_base_64: "",
				sample_rate: 16_000,
				extra: 1,
			},
			false,
		],
		[
			"a mismatched sample rate",
			{
				message_type: "input_audio_chunk",
				audio_base_64: "AAAA",
				sample_rate: 48_000,
			},
			false,
		],
	])("rejects %s without forwarding it", async (_name, message, isBinary) => {
		const { upstream, clientSends, clientMessages, session } = createSession();
		clientSends(message, isBinary);
		await flush();
		expect(upstream.sent).toEqual([]);
		expect(clientMessages()).toEqual([
			expect.objectContaining({ message_type: "error", source: "llmgateway" }),
		]);
		session.shutdown(1000, "test");
	});

	it("refuses audio when the account no longer clears the gates", async () => {
		vi.mocked(authorizeAccount).mockResolvedValueOnce({
			ok: false,
			code: "insufficient_credits",
			message: "No credits.",
			severity: "deny",
		} as Awaited<ReturnType<typeof authorizeAccount>>);
		const { client, upstream, clientSends, chunk } = createSession();
		clientSends(chunk(3200));
		await flush();
		expect(upstream.sent).toEqual([]);
		expect(client.closed[0]?.code).toBe(1008);
	});

	it("does not deliver a transcript it could not bill", async () => {
		vi.mocked(recordRealtimeTranscription).mockRejectedValueOnce(
			new Error("db down"),
		);
		const { client, clientSends, upstreamSends, chunk, clientMessages } =
			createSession();
		clientSends(chunk(3200, { commit: true }));
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "hello" });
		await flush();
		expect(clientMessages()).toEqual([]);
		expect(client.closed[0]).toEqual({
			code: 1011,
			reason: "billing_unavailable",
		});
	});

	it("counts one provider request and reauthorizes after each charge", async () => {
		const { clientSends, upstreamSends, chunk, session } = createSession();
		clientSends(chunk(3200, { commit: true }));
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "a" });
		await flush();
		clientSends(chunk(3200, { commit: true }));
		await flush();
		upstreamSends({ message_type: "committed_transcript", text: "b" });
		await flush();
		expect(checkProviderRateLimit).toHaveBeenCalledTimes(1);
		expect(authorizeAccount).toHaveBeenCalledTimes(2);
		expect(availableCredits).toHaveBeenCalledTimes(2);
		expect(billedSeconds()).toEqual([0.1, 0.1]);
		session.shutdown(1000, "test");
	});

	it("checks credits before forwarding the first chunk", async () => {
		vi.mocked(availableCredits).mockResolvedValueOnce(new Decimal(0));
		const { client, upstream, clientSends, chunk, clientMessages } =
			createSession();
		clientSends(chunk(3200));
		await flush();
		expect(upstream.sent).toEqual([]);
		expect(clientMessages()[0]).toMatchObject({ code: "insufficient_credits" });
		expect(client.closed[0]?.code).toBe(1008);
		expect(recordRealtimeTranscription).not.toHaveBeenCalled();
	});

	it("does not bill audio it could not forward", async () => {
		const { client, upstream, clientSends, chunk, clientMessages } =
			createSession();
		upstream.readyState = 3;
		clientSends(chunk(32_000));
		client.emit("close");
		await flush();
		expect(clientMessages()[0]).toMatchObject({ code: "upstream_unavailable" });
		expect(recordRealtimeTranscription).not.toHaveBeenCalled();
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
		const { client, clientSends, chunk, session } = createSession();
		for (let i = 0; i < 4; i++) {
			clientSends(chunk(1024 * 1024));
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
			const { clientSends, chunk, session } = createSession();
			clientSends(chunk(320));
			await flush();
			clientSends(chunk(320));
			await flush();
			expect(authorizeAccount).toHaveBeenCalledTimes(1);
			vi.setSystemTime(Date.now() + 5001);
			clientSends(chunk(320));
			await flush();
			expect(authorizeAccount).toHaveBeenCalledTimes(2);
			session.shutdown(1000, "test");
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses audio without closing when the balance is unreadable", async () => {
		vi.mocked(availableCredits).mockResolvedValueOnce(null);
		const { client, upstream, clientSends, chunk, clientMessages, session } =
			createSession();
		clientSends(chunk(320));
		await flush();
		expect(upstream.sent).toEqual([]);
		expect(clientMessages()[0]).toMatchObject({ code: "gate_unavailable" });
		expect(client.closed).toEqual([]);
		clientSends(chunk(320));
		await flush();
		expect(upstream.sent).toHaveLength(1);
		session.shutdown(1000, "test");
	});
});
