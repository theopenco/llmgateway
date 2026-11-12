import { Decimal } from "decimal.js";
import { WebSocket } from "ws";

import {
	checkProviderRateLimit,
	peekProviderRateLimit,
} from "@/lib/provider-rate-limit.js";

import { getEffectiveDiscount } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { authorizeAccount, availableCredits } from "./account-gate.js";
import {
	closeRealtimeSessionRecord,
	recordRealtimeTranscription,
} from "./billing.js";
import {
	LEASE_HEARTBEAT_INTERVAL_MS,
	releaseRealtimeLease,
	renewRealtimeLease,
	type RealtimeLease,
} from "./leases.js";
import {
	applyTranscriptionDiscount,
	buildTranscriptionPriceSnapshot,
	priceTranscriptionUsage,
} from "./transcription.js";
import { logRealtimeTurnDenial } from "./turn-denial-log.js";

import type { ElevenLabsRealtimeConfig } from "./elevenlabs.js";
import type { RealtimePreflightResult } from "./preflight.js";
import type { RawData } from "ws";

const maxSessionMs = () =>
	(Number(process.env.REALTIME_MAX_SESSION_SECONDS) || 3600) * 1000;
const maxSessionSpendUsd = () =>
	process.env.REALTIME_MAX_SESSION_SPEND_USD || "10";
const maxBufferedBytes = () =>
	Number(process.env.REALTIME_MAX_BUFFERED_BYTES) || 4 * 1024 * 1024;
const backpressureTimeoutMs = () =>
	Number(process.env.REALTIME_BACKPRESSURE_TIMEOUT_MS) || 30_000;
const pingIntervalMs = () =>
	Number(process.env.REALTIME_PING_INTERVAL_MS) || 15_000;

/**
 * Audio is billed at every committed transcript and, without commits, once
 * this much unbilled audio has been forwarded, so a session that never
 * commits still clears the account gates regularly.
 */
const BILLING_INTERVAL_SECONDS = 30;

/** Upstream events that close a transcript segment. */
const COMMIT_EVENTS = new Set([
	"committed_transcript",
	"committed_transcript_with_timestamps",
]);

const CHUNK_KEYS = new Set([
	"message_type",
	"audio_base_64",
	"commit",
	"sample_rate",
	"previous_text",
]);

/**
 * Gateway-generated errors use ElevenLabs' own error shape so clients handle
 * them, with `source` telling them apart from upstream errors.
 */
function buildGatewayError(code: string, message: string): string {
	return JSON.stringify({
		message_type: "error",
		error: message,
		code,
		source: "llmgateway",
	});
}

function frameSize(data: RawData): number {
	if (Buffer.isBuffer(data)) {
		return data.length;
	}
	if (Array.isArray(data)) {
		return data.reduce((sum, b) => sum + b.length, 0);
	}
	return data.byteLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface ElevenLabsRealtimeProxySessionOptions {
	clientSocket: WebSocket;
	upstreamSocket: WebSocket;
	preflight: RealtimePreflightResult;
	config: ElevenLabsRealtimeConfig;
	gatewayToken: string;
	requestedModel: string;
	sessionRecordId: string;
	lease: RealtimeLease;
	source: string | null;
	userAgent: string | undefined;
	onClosed: (session: ElevenLabsRealtimeProxySession) => void;
}

/**
 * One ElevenLabs Scribe Live transcription session: a client WebSocket bridged
 * to ElevenLabs' realtime speech-to-text WebSocket in its native protocol.
 * ElevenLabs reports no usage on the socket and bills every second of audio
 * sent, so the gateway meters the audio it forwards, billing it before each
 * committed transcript is delivered and on close.
 */
export class ElevenLabsRealtimeProxySession {
	private readonly client: WebSocket;
	private readonly upstream: WebSocket;
	private readonly preflight: RealtimePreflightResult;
	private readonly config: ElevenLabsRealtimeConfig;
	private readonly gatewayToken: string;
	private readonly requestedModel: string;
	public readonly sessionRecordId: string;
	private readonly lease: RealtimeLease;
	private readonly source: string | null;
	private readonly userAgent: string | undefined;
	private readonly onClosed: (session: ElevenLabsRealtimeProxySession) => void;

	private bytesIn = 0;
	private bytesOut = 0;
	private sessionSpend = new Decimal(0);

	// Audio forwarded upstream and not yet billed, in bytes of the session's
	// audio format.
	private unbilledAudioBytes = 0;
	private billedSegments = 0;
	// Billing runs one at a time, from either socket's queue.
	private billingQueue: Promise<boolean> = Promise.resolve(true);
	// Set while the post-billing gates run; audio waits for the verdict.
	private postBillingGate: Promise<void> = Promise.resolve();
	private authorized = false;

	private finalized = false;
	private closing = false;
	private clientAlive = true;
	private upstreamAlive = true;
	private readonly timers: NodeJS.Timeout[] = [];
	// One poller per direction, so a slow client and a slow upstream are each
	// throttled.
	private readonly backpressurePollers = new Map<WebSocket, NodeJS.Timeout>();
	// Reasons the client socket is paused; it resumes when none remain.
	private readonly clientPauses = new Set<string>();
	// Bytes of client frames received but not yet handled.
	private queuedClientBytes = 0;
	private clientQueue: Promise<void> = Promise.resolve();
	private upstreamQueue: Promise<void> = Promise.resolve();

	public constructor(options: ElevenLabsRealtimeProxySessionOptions) {
		this.client = options.clientSocket;
		this.upstream = options.upstreamSocket;
		this.preflight = options.preflight;
		this.config = options.config;
		this.gatewayToken = options.gatewayToken;
		this.requestedModel = options.requestedModel;
		this.sessionRecordId = options.sessionRecordId;
		this.lease = options.lease;
		this.source = options.source;
		this.userAgent = options.userAgent;
		this.onClosed = options.onClosed;

		this.client.on("message", (data, isBinary) => {
			// Frames wait here while authorization or billing runs; stop reading
			// once too many are queued.
			const size = frameSize(data);
			this.queuedClientBytes += size;
			if (this.queuedClientBytes > maxBufferedBytes()) {
				this.pauseClient("queue");
			}
			this.clientQueue = this.clientQueue
				.then(() => this.handleClientMessage(data, isBinary, size))
				.finally(() => {
					this.queuedClientBytes -= size;
					if (this.queuedClientBytes <= maxBufferedBytes() / 4) {
						this.resumeClient("queue");
					}
				})
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle ElevenLabs realtime client message; closing session",
						error as Error,
					);
					void this.settleAndShutdown(1011, "internal_error");
				});
		});
		this.upstream.on("message", (data) => {
			this.upstreamQueue = this.upstreamQueue
				.then(() => this.handleUpstreamMessage(data))
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle ElevenLabs realtime upstream message; closing session",
						error as Error,
					);
					void this.settleAndShutdown(1011, "internal_error");
				});
		});
		this.client.on("close", () => {
			// Queued behind the client's messages so audio still being forwarded
			// is counted before the tail is billed.
			this.clientQueue = this.clientQueue.then(() =>
				this.settleAndShutdown(1000, "client_disconnected"),
			);
		});
		this.upstream.on("close", (code, reason) => {
			const upstreamReason = reason.toString().trim().slice(0, 90);
			if (code !== 1000) {
				logger.warn("ElevenLabs realtime upstream closed the session", {
					sessionId: this.sessionRecordId,
					code,
					reason: upstreamReason,
				});
			}
			this.upstreamQueue = this.upstreamQueue.then(() =>
				this.settleAndShutdown(
					code === 1000 ? 1000 : 1011,
					code === 1000
						? "upstream_closed"
						: upstreamReason
							? `upstream_closed_${code}: ${upstreamReason}`
							: `upstream_closed_${code}`,
				),
			);
		});
		this.client.on("error", (error) => {
			logger.warn("ElevenLabs realtime client socket error", {
				sessionId: this.sessionRecordId,
				error: error.message,
			});
		});
		this.upstream.on("error", (error) => {
			logger.warn("ElevenLabs realtime upstream socket error", {
				sessionId: this.sessionRecordId,
				error: error.message,
			});
		});
		this.client.on("pong", () => {
			this.clientAlive = true;
		});
		this.upstream.on("pong", () => {
			this.upstreamAlive = true;
		});

		this.timers.push(
			setTimeout(() => {
				this.sendToClientRaw(
					buildGatewayError(
						"session_duration_limit",
						"Maximum realtime session duration reached. Reconnect to continue.",
					),
				);
				void this.settleAndShutdown(1000, "session_duration_limit");
			}, maxSessionMs()),
		);
		this.timers.push(
			setInterval(() => {
				if (!this.clientAlive || !this.upstreamAlive) {
					void this.settleAndShutdown(1011, "ping_timeout");
					return;
				}
				this.clientAlive = false;
				this.upstreamAlive = false;
				try {
					if (this.client.readyState === WebSocket.OPEN) {
						this.client.ping();
					} else {
						this.clientAlive = true;
					}
					if (this.upstream.readyState === WebSocket.OPEN) {
						this.upstream.ping();
					} else {
						this.upstreamAlive = true;
					}
				} catch {
					// Socket already closing; the close handlers finalize the session.
				}
			}, pingIntervalMs()),
		);
		this.timers.push(
			setInterval(() => {
				void renewRealtimeLease(this.lease);
			}, LEASE_HEARTBEAT_INTERVAL_MS),
		);
	}

	// --- Client → upstream ---

	private async handleClientMessage(
		data: RawData,
		isBinary: boolean,
		size: number,
	): Promise<void> {
		this.bytesIn += size;

		if (isBinary) {
			this.sendToClientRaw(
				buildGatewayError(
					"invalid_frame",
					"Binary frames are not supported; send input_audio_chunk JSON messages.",
				),
			);
			return;
		}

		let message: Record<string, unknown>;
		try {
			const parsed = JSON.parse(data.toString()) as unknown;
			if (!isPlainObject(parsed)) {
				throw new Error("not an object");
			}
			message = parsed;
		} catch {
			this.sendToClientRaw(
				buildGatewayError(
					"invalid_json",
					"Client message is not a JSON object.",
				),
			);
			return;
		}

		if (message.message_type !== "input_audio_chunk") {
			this.sendToClientRaw(
				buildGatewayError(
					"unsupported_message_type",
					"Only input_audio_chunk messages are supported.",
				),
			);
			return;
		}
		const unknownKey = Object.keys(message).find((key) => !CHUNK_KEYS.has(key));
		if (unknownKey !== undefined) {
			this.sendToClientRaw(
				buildGatewayError(
					"invalid_audio_chunk",
					`Unsupported input_audio_chunk field: ${unknownKey}`,
				),
			);
			return;
		}
		if (
			typeof message.audio_base_64 !== "string" ||
			(message.commit !== undefined && typeof message.commit !== "boolean") ||
			(message.previous_text !== undefined &&
				typeof message.previous_text !== "string")
		) {
			this.sendToClientRaw(
				buildGatewayError(
					"invalid_audio_chunk",
					"input_audio_chunk requires a base64 audio_base_64 string; commit must be a boolean and previous_text a string.",
				),
			);
			return;
		}
		// Audio is metered against the session's audio_format, so a chunk
		// claiming another sample rate would be billed for the wrong duration.
		if (
			message.sample_rate !== undefined &&
			message.sample_rate !== this.config.sampleRate
		) {
			this.sendToClientRaw(
				buildGatewayError(
					"sample_rate_mismatch",
					`sample_rate must match the session's audio_format (${this.config.sampleRate} Hz). Set audio_format in the connection URL.`,
				),
			);
			return;
		}

		if (!(await this.authorizeAudio())) {
			return;
		}

		const forwarded = this.forwardToUpstream(
			JSON.stringify({
				...message,
				sample_rate: this.config.sampleRate,
				commit: message.commit === true,
			}),
		);
		if (!forwarded) {
			return;
		}
		this.unbilledAudioBytes += Buffer.from(
			message.audio_base_64,
			"base64",
		).length;

		if (this.unbilledSeconds() >= BILLING_INTERVAL_SECONDS) {
			if (await this.billAudio()) {
				this.afterBilling();
			}
		}
	}

	/**
	 * Authorize the session's input stream once — account, credits, and one
	 * provider rate-limit request for the session — then rely on the
	 * post-billing gates to stop it when the account no longer clears them.
	 */
	private async authorizeAudio(): Promise<boolean> {
		await this.postBillingGate;
		if (this.finalized || this.closing) {
			return false;
		}
		if (this.authorized) {
			return true;
		}
		const authorization = await authorizeAccount({
			preflight: this.preflight,
			gatewayToken: this.gatewayToken,
			requestedModel: this.requestedModel,
			match: this.preflight.match,
		});
		if (this.finalized || this.closing) {
			return false;
		}
		if (!authorization.ok) {
			this.refuse(authorization.code, authorization.message);
			if (authorization.severity !== "transient") {
				void this.settleAndShutdown(1008, authorization.code);
			}
			return false;
		}
		if (
			!(await this.creditsRemain(authorization.organization)) ||
			!(await this.rateLimitAllows(checkProviderRateLimit))
		) {
			return false;
		}
		if (this.finalized || this.closing) {
			return false;
		}
		this.authorized = true;
		return true;
	}

	/** Close the session when the organization has no credits left. */
	private async creditsRemain(
		organization: Parameters<typeof availableCredits>[1],
	): Promise<boolean> {
		if (this.preflight.usedMode !== "credits") {
			return true;
		}
		const available = await availableCredits(
			this.preflight.project.organizationId,
			organization,
		);
		if (available !== null && available.lessThanOrEqualTo(0)) {
			this.refuse(
				"insufficient_credits",
				"Organization has insufficient credits to continue this session.",
			);
			void this.settleAndShutdown(1008, "insufficient_credits");
			return false;
		}
		return true;
	}

	/**
	 * Close the session when the provider rate limit is exhausted. The session
	 * counts as one provider request: it is counted when audio is first
	 * authorized and only peeked at billing checkpoints.
	 */
	private async rateLimitAllows(
		check: typeof checkProviderRateLimit | typeof peekProviderRateLimit,
	): Promise<boolean> {
		const rateLimit = await check(
			this.preflight.project.organizationId,
			this.preflight.match.mapping.providerId,
			this.preflight.match.modelId,
		);
		if (rateLimit.allowed) {
			return true;
		}
		this.refuse(
			"rate_limit_exceeded",
			`Provider rate limit exceeded${rateLimit.retryAfter ? `; retry after ${rateLimit.retryAfter}s` : ""}.`,
		);
		void this.settleAndShutdown(1008, "rate_limit_exceeded");
		return false;
	}

	// --- Upstream → client ---

	private async handleUpstreamMessage(data: RawData): Promise<void> {
		const text = data.toString();
		this.bytesOut += text.length;

		let messageType: unknown;
		try {
			const parsed = JSON.parse(text) as unknown;
			messageType = isPlainObject(parsed) ? parsed.message_type : undefined;
		} catch {
			messageType = undefined;
		}

		if (typeof messageType === "string" && COMMIT_EVENTS.has(messageType)) {
			// Bill the audio behind the segment before its transcript is delivered.
			if (!(await this.billAudio())) {
				return;
			}
			this.sendToClientRaw(text);
			this.afterBilling();
			return;
		}
		this.sendToClientRaw(text);
	}

	// --- Billing ---

	private unbilledSeconds(): number {
		return this.unbilledAudioBytes / this.config.bytesPerSecond;
	}

	/**
	 * Bill all forwarded audio not yet billed. Returns false when the session
	 * was closed instead.
	 */
	private billAudio(): Promise<boolean> {
		this.billingQueue = this.billingQueue.then(() => this.billPending());
		return this.billingQueue;
	}

	private async billPending(): Promise<boolean> {
		if (this.finalized) {
			return false;
		}
		const bytes = this.unbilledAudioBytes;
		if (bytes === 0) {
			return true;
		}
		this.unbilledAudioBytes = 0;
		const seconds = bytes / this.config.bytesPerSecond;
		const usage = {
			totalTokens: 0,
			inputTokens: 0,
			outputTokens: 0,
			inputTextTokens: 0,
			inputAudioTokens: 0,
			inputAudioSeconds: seconds,
		};
		const { match } = this.preflight;
		const snapshot = buildTranscriptionPriceSnapshot(match.mapping);
		const priced = priceTranscriptionUsage(usage, snapshot);
		if (!priced.ok) {
			logger.error(`Unpriceable ElevenLabs realtime audio: ${priced.reason}`, {
				sessionId: this.sessionRecordId,
			});
			this.shutdown(1011, `unpriceable_usage:${priced.reason}`);
			return false;
		}

		let discount: Decimal;
		try {
			const effectiveDiscount = await getEffectiveDiscount(
				this.preflight.project.organizationId,
				match.mapping.providerId,
				match.modelId,
			);
			discount = new Decimal(effectiveDiscount.discount);
		} catch (error) {
			logger.error(
				"Failed to resolve ElevenLabs realtime discount; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return false;
		}
		const costs = applyTranscriptionDiscount(priced.costs, discount);

		this.billedSegments += 1;
		try {
			const { inserted } = await recordRealtimeTranscription({
				preflight: this.preflight,
				sessionId: this.sessionRecordId,
				transcription: match,
				requestedModel: this.requestedModel,
				itemId: `audio-${this.billedSegments}`,
				contentIndex: 0,
				responseSizeBytes: bytes,
				usage,
				costs,
				pricingSnapshot: snapshot,
				discount: discount.toNumber(),
				source: this.source,
				userAgent: this.userAgent,
			});
			if (inserted) {
				this.sessionSpend = this.sessionSpend.plus(costs.totalCost);
			}
		} catch (error) {
			logger.error(
				"Failed to persist ElevenLabs realtime billing event; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return false;
		}
		return true;
	}

	/**
	 * Re-run the account gates after a charge. Audio waits for the verdict so
	 * a session that just lost its authorization cannot stream past it.
	 */
	private afterBilling(): void {
		if (this.finalized || this.closing) {
			return;
		}
		this.postBillingGate = this.enforceLimits().catch((error: unknown) => {
			logger.error(
				"ElevenLabs realtime post-billing gate failed; closing session",
				error as Error,
			);
			this.shutdown(1011, "internal_error");
		});
	}

	private async enforceLimits(): Promise<void> {
		if (this.sessionSpend.greaterThanOrEqualTo(maxSessionSpendUsd())) {
			this.refuse(
				"session_spend_limit",
				`This session has reached its spend limit ($${maxSessionSpendUsd()}). Reconnect to start a new session.`,
			);
			void this.settleAndShutdown(1008, "session_spend_limit");
			return;
		}

		const authorization = await authorizeAccount({
			preflight: this.preflight,
			gatewayToken: this.gatewayToken,
			requestedModel: this.requestedModel,
			match: this.preflight.match,
		});
		if (!authorization.ok) {
			if (authorization.severity === "transient") {
				return;
			}
			this.refuse(authorization.code, authorization.message);
			void this.settleAndShutdown(1008, authorization.code);
			return;
		}

		if (!(await this.creditsRemain(authorization.organization))) {
			return;
		}
		await this.rateLimitAllows(peekProviderRateLimit);
	}

	/** Refuse further audio and log it like a rejected HTTP request. */
	private refuse(code: string, message: string): void {
		this.sendToClientRaw(buildGatewayError(code, message));
		void logRealtimeTurnDenial({
			gatewayToken: this.gatewayToken,
			sessionRecordId: this.sessionRecordId,
			requestedModel: this.requestedModel,
			source: this.source,
			userAgent: this.userAgent,
			code,
			message,
		});
	}

	// --- Lifecycle ---

	/**
	 * Bill the forwarded audio that no committed transcript has covered — the
	 * provider charges for it regardless — then close. Every shutdown other
	 * than a billing failure goes through here.
	 */
	private settleAndShutdown(code: number, reason: string): Promise<void> {
		if (this.finalized) {
			return Promise.resolve();
		}
		this.closing = true;
		return this.billAudio()
			.catch((error: unknown) => {
				logger.error(
					"Failed to bill trailing ElevenLabs realtime audio",
					error as Error,
				);
			})
			.then(() => this.shutdown(code, reason));
	}

	/** Force-close from outside (server drain), billing the tail first. */
	public close(code: number, reason: string): void {
		void this.settleAndShutdown(code, reason);
	}

	/** Close both sockets and finalize the session record. Idempotent. */
	public shutdown(code: number, reason: string): void {
		if (this.finalized) {
			return;
		}
		this.finalized = true;

		for (const timer of this.timers) {
			clearInterval(timer);
			clearTimeout(timer);
		}
		for (const poller of this.backpressurePollers.values()) {
			clearInterval(poller);
		}
		this.backpressurePollers.clear();

		try {
			if (
				this.client.readyState === WebSocket.OPEN ||
				this.client.readyState === WebSocket.CONNECTING
			) {
				this.client.close(code, reason.slice(0, 120));
			}
		} catch {
			this.client.terminate();
		}
		try {
			if (
				this.upstream.readyState === WebSocket.OPEN ||
				this.upstream.readyState === WebSocket.CONNECTING
			) {
				this.upstream.close(1000);
			}
		} catch {
			this.upstream.terminate();
		}

		void releaseRealtimeLease(this.lease);
		void closeRealtimeSessionRecord(
			this.sessionRecordId,
			reason.startsWith("unpriceable_usage") || reason === "billing_unavailable"
				? "error"
				: "closed",
			reason,
			{ bytesIn: this.bytesIn, bytesOut: this.bytesOut },
		).catch((error: unknown) => {
			logger.error(
				"Failed to finalize ElevenLabs realtime session record",
				error as Error,
			);
		});

		this.onClosed(this);
	}

	// --- Socket plumbing with backpressure ---

	private sendToClientRaw(text: string): void {
		if (this.client.readyState !== WebSocket.OPEN) {
			return;
		}
		this.client.send(text);
		this.applyBackpressure(this.client, this.upstream);
	}

	/** Returns false when the frame could not be sent. */
	private forwardToUpstream(text: string): boolean {
		if (this.upstream.readyState !== WebSocket.OPEN) {
			this.sendToClientRaw(
				buildGatewayError(
					"upstream_unavailable",
					"The upstream realtime connection is no longer available.",
				),
			);
			return false;
		}
		this.upstream.send(text);
		this.applyBackpressure(this.upstream, this.client);
		return true;
	}

	private pauseClient(reason: string): void {
		if (this.clientPauses.size === 0) {
			this.client.pause();
		}
		this.clientPauses.add(reason);
	}

	private resumeClient(reason: string): void {
		if (this.clientPauses.delete(reason) && this.clientPauses.size === 0) {
			this.client.resume();
		}
	}

	private pauseSource(source: WebSocket): void {
		if (source === this.client) {
			this.pauseClient("backpressure");
		} else {
			source.pause();
		}
	}

	private resumeSource(source: WebSocket): void {
		if (source === this.client) {
			this.resumeClient("backpressure");
		} else {
			source.resume();
		}
	}

	/**
	 * When the destination socket's send buffer exceeds the high-water mark,
	 * pause reading from the source socket until it drains (or close the
	 * session if it never does).
	 */
	private applyBackpressure(destination: WebSocket, source: WebSocket): void {
		if (this.backpressurePollers.has(destination)) {
			return;
		}
		if (destination.bufferedAmount <= maxBufferedBytes()) {
			return;
		}
		this.pauseSource(source);
		const startedAt = Date.now();
		const stop = () => {
			const poller = this.backpressurePollers.get(destination);
			if (poller) {
				clearInterval(poller);
				this.backpressurePollers.delete(destination);
			}
		};
		this.backpressurePollers.set(
			destination,
			setInterval(() => {
				if (this.finalized) {
					stop();
					return;
				}
				if (destination.bufferedAmount <= maxBufferedBytes() / 4) {
					stop();
					this.resumeSource(source);
					return;
				}
				if (Date.now() - startedAt > backpressureTimeoutMs()) {
					stop();
					void this.settleAndShutdown(1011, "backpressure_timeout");
				}
			}, 100),
		);
	}
}
