import { Decimal } from "decimal.js";
import { WebSocket } from "ws";

import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import { getEffectiveDiscount } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { authorizeAccount, availableCredits } from "./account-gate.js";
import {
	closeRealtimeSessionRecord,
	markRealtimeSessionUpstream,
	recordRealtimeTranscription,
} from "./billing.js";
import { findRealtimeTranscriptionMapping } from "./catalog.js";
import { discardUpstream } from "./connect-upstream.js";
import {
	buildElevenLabsUpstreamQuery,
	DEFAULT_ELEVENLABS_SESSION_CONFIG,
	elevenLabsAudioRate,
	parseElevenLabsAudioFormat,
	parseElevenLabsTurnDetection,
	type ElevenLabsSessionConfig,
} from "./elevenlabs.js";
import { RealtimeConnectError } from "./errors.js";
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

/**
 * Audio is forwarded on a cached authorization for at most this long, and
 * never past a charge, so a revoked key or exhausted balance stops egress
 * within seconds.
 */
const REAUTHORIZE_INTERVAL_MS = 5000;

/**
 * ElevenLabs refuses a commit of less uncommitted audio than this and closes
 * the connection, so the gateway rejects it first.
 */
const MIN_COMMIT_SECONDS = 0.3;

/**
 * ElevenLabs closes idle connections normally, and the gateway reopens them on
 * the next audio. Connections that keep failing without a transcript end the
 * session.
 */
const MAX_UPSTREAM_FAILURES_WITHOUT_TRANSCRIPT = 3;

/** Upstream errors that a reconnect cannot fix. */
const FATAL_UPSTREAM_ERRORS = new Set([
	"auth_error",
	"quota_exceeded",
	"unaccepted_terms",
]);

/** Upstream errors that reject the pending commit. */
const COMMIT_ERRORS = new Set([
	"commit_throttled",
	"insufficient_audio_activity",
]);

/** Upstream errors caused by the client's input. */
const CLIENT_UPSTREAM_ERRORS = new Set([
	"input_error",
	"chunk_size_exceeded",
	"commit_throttled",
	"insufficient_audio_activity",
]);

let eventCounter = 0;

function nextEventId(): string {
	eventCounter += 1;
	return `event_lmg_${Date.now()}_${eventCounter}`;
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

function roundSeconds(seconds: number): number {
	return Math.round(seconds * 1000) / 1000;
}

export interface ElevenLabsRealtimeProxySessionOptions {
	clientSocket: WebSocket;
	/**
	 * Opens the ElevenLabs upstream with the given query. Called lazily: the
	 * upstream is configured at connection time, from the session config the
	 * client set with session.update before its first audio.
	 */
	connectUpstream: (query: URLSearchParams) => Promise<WebSocket>;
	/** Validated ElevenLabs-only parameters from the connection URL. */
	extensionQuery: URLSearchParams;
	preflight: RealtimePreflightResult;
	gatewayToken: string;
	requestedModel: string;
	sessionRecordId: string;
	lease: RealtimeLease;
	source: string | null;
	userAgent: string | undefined;
	onClosed: (session: ElevenLabsRealtimeProxySession) => void;
}

interface CommittedItem {
	itemId: string;
	seconds: number;
}

/**
 * One ElevenLabs Scribe Live transcription session, served to the client as
 * an OpenAI realtime transcription session. The gateway keeps the OpenAI
 * session state, opens ElevenLabs' native WebSocket on the first audio with
 * the matching query parameters, and translates events both ways.
 * ElevenLabs reports no usage and bills every second of audio sent, so the
 * gateway meters the audio it forwards, billing it before each completed
 * transcript is delivered and on close.
 */
export class ElevenLabsRealtimeProxySession {
	private readonly client: WebSocket;
	private readonly connect: (query: URLSearchParams) => Promise<WebSocket>;
	private readonly extensionQuery: URLSearchParams;
	private readonly preflight: RealtimePreflightResult;
	private readonly gatewayToken: string;
	private readonly requestedModel: string;
	public readonly sessionRecordId: string;
	private readonly lease: RealtimeLease;
	private readonly source: string | null;
	private readonly userAgent: string | undefined;
	private readonly onClosed: (session: ElevenLabsRealtimeProxySession) => void;
	private readonly openedAt = Date.now();

	private config: ElevenLabsSessionConfig = DEFAULT_ELEVENLABS_SESSION_CONFIG;
	private upstream: WebSocket | null = null;
	private upstreamRate: { sampleRate: number; bytesPerSecond: number } | null =
		null;
	private upstreamSessionRecorded = false;
	private upstreamFatal = false;
	private upstreamFailuresWithoutTranscript = 0;
	private promptSent = false;

	// The item receiving audio and partial transcripts, its latest partial
	// text, the text delivered as deltas, and the seconds of audio streamed
	// since the last commit.
	private currentItemId: string | null = null;
	private currentPartial = "";
	private deliveredPartial = "";
	private segmentSeconds = 0;
	private totalAudioMs = 0;
	private itemCounter = 0;
	private lastItemId: string | null = null;
	// Client commits awaiting their committed_transcript, in order.
	private commitQueue: CommittedItem[] = [];

	private bytesIn = 0;
	private bytesOut = 0;
	private sessionSpend = new Decimal(0);

	// Audio forwarded upstream and not yet billed.
	private unbilledAudioSeconds = 0;
	private unbilledAudioBytes = 0;
	private billedSegments = 0;
	// Billing runs one at a time, from either socket's queue.
	private billingQueue: Promise<boolean> = Promise.resolve(true);
	// When audio was last authorized; null forces a check before the next chunk.
	private authorizedAt: number | null = null;
	private rateLimitCounted = false;
	// Incremented by every charge, so an authorization that a charge overtook
	// is not cached.
	private chargeGeneration = 0;

	private finalized = false;
	private closing = false;
	private clientAlive = true;
	private upstreamAlive = true;
	private readonly timers: NodeJS.Timeout[] = [];
	// One poller per destination, so a slow client and a slow upstream are
	// each throttled.
	private readonly backpressurePollers = new Map<WebSocket, NodeJS.Timeout>();
	// Reasons the client socket is paused; it resumes when none remain.
	private readonly clientPauses = new Set<string>();
	// Bytes of client frames received but not yet handled.
	private queuedClientBytes = 0;
	private clientQueue: Promise<void> = Promise.resolve();
	private upstreamQueue: Promise<void> = Promise.resolve();

	public constructor(options: ElevenLabsRealtimeProxySessionOptions) {
		this.client = options.clientSocket;
		this.connect = options.connectUpstream;
		this.extensionQuery = options.extensionQuery;
		this.preflight = options.preflight;
		this.gatewayToken = options.gatewayToken;
		this.requestedModel = options.requestedModel;
		this.sessionRecordId = options.sessionRecordId;
		this.lease = options.lease;
		this.source = options.source;
		this.userAgent = options.userAgent;
		this.onClosed = options.onClosed;

		this.client.on("message", (data, isBinary) => {
			// Frames wait here while authorization, connecting or billing runs;
			// stop reading once too many are queued.
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
		this.client.on("close", () => {
			// Queued behind the client's messages so audio still being forwarded
			// is counted before the tail is billed.
			this.clientQueue = this.clientQueue.then(() =>
				this.settleAndShutdown(1000, "client_disconnected"),
			);
		});
		this.client.on("error", (error) => {
			logger.warn("ElevenLabs realtime client socket error", {
				sessionId: this.sessionRecordId,
				error: error.message,
			});
		});
		this.client.on("pong", () => {
			this.clientAlive = true;
		});

		this.timers.push(
			setTimeout(() => {
				this.sendError(
					"session_duration_limit",
					"Maximum realtime session duration reached. Reconnect to continue.",
				);
				void this.settleAndShutdown(1000, "session_duration_limit");
			}, maxSessionMs()),
		);
		this.timers.push(
			setInterval(() => {
				if (!this.clientAlive || (this.upstream && !this.upstreamAlive)) {
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
					if (this.upstream?.readyState === WebSocket.OPEN) {
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

		this.sendEvent({ type: "session.created", session: this.sessionObject() });
	}

	// --- Session state ---

	private canonicalModelId(): string {
		const { match } = this.preflight;
		return formatUsedModelForDisplay(
			match.mapping.providerId,
			match.modelId,
			undefined,
			match.mapping.region,
		);
	}

	/** Whether a requested model names this session's pinned mapping. */
	private isSessionModel(model: string): boolean {
		const { mapping } = this.preflight.match;
		const match = findRealtimeTranscriptionMapping(model, mapping.providerId);
		return (
			match?.mapping.providerId === mapping.providerId &&
			match.mapping.externalId === mapping.externalId
		);
	}

	private sessionObject(): Record<string, unknown> {
		const { config } = this;
		return {
			type: "transcription",
			id: `sess_lmg_${this.sessionRecordId}`,
			object: "realtime.transcription_session",
			expires_at: Math.floor((this.openedAt + maxSessionMs()) / 1000),
			include: null,
			audio: {
				input: {
					format: config.format,
					noise_reduction: config.noiseReduction,
					transcription: {
						model: this.canonicalModelId(),
						language: config.language,
						prompt: config.prompt,
						...(config.secondaryLanguages.length > 0 && {
							languages: [config.language, ...config.secondaryLanguages],
						}),
					},
					turn_detection: config.turnDetection,
				},
			},
		};
	}

	private nextItemId(): string {
		this.itemCounter += 1;
		return `item_lmg_${this.sessionRecordId}_${this.itemCounter}`;
	}

	private resetSegment(): void {
		this.currentItemId = null;
		this.currentPartial = "";
		this.deliveredPartial = "";
		this.segmentSeconds = 0;
	}

	// --- Client → upstream ---

	private async handleClientMessage(
		data: RawData,
		isBinary: boolean,
		size: number,
	): Promise<void> {
		this.bytesIn += size;

		if (isBinary) {
			this.sendError(
				"invalid_frame",
				"Binary frames are not supported; send JSON client events.",
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
			this.sendError("invalid_json", "Client event is not a JSON object.");
			return;
		}

		const type = typeof message.type === "string" ? message.type : "";
		const clientEventId = message.event_id;
		switch (type) {
			case "session.update":
				await this.handleSessionUpdate(message, clientEventId);
				return;
			case "input_audio_buffer.append":
				await this.handleAppend(message, clientEventId);
				return;
			case "input_audio_buffer.commit":
				this.handleCommit(clientEventId);
				return;
			case "input_audio_buffer.clear":
				await this.handleClear(clientEventId);
				return;
			case "response.create":
				this.sendError(
					"response_not_supported",
					"Transcription sessions only transcribe input audio and cannot generate responses. Open a realtime session to use response.create.",
					clientEventId,
				);
				return;
			default:
				this.sendError(
					"unsupported_client_event",
					type === "transcription_session.update"
						? "transcription_session.update is not supported; configure transcription with session.update."
						: `Unsupported client event type: ${type}`,
					clientEventId,
				);
		}
	}

	private async handleSessionUpdate(
		message: Record<string, unknown>,
		clientEventId: unknown,
	): Promise<void> {
		const session = isPlainObject(message.session) ? message.session : {};
		const reject = (code: string, text: string) => {
			this.sendError(code, text, clientEventId);
		};
		if (session.type !== undefined && session.type !== "transcription") {
			reject(
				"invalid_session_type",
				'This is a transcription session; session.type must be "transcription".',
			);
			return;
		}
		if (session.model !== undefined) {
			if (
				typeof session.model !== "string" ||
				!this.isSessionModel(session.model)
			) {
				reject(
					"model_locked",
					"The session model is locked at connection time and cannot be changed via session.update.",
				);
				return;
			}
		}

		const audio = isPlainObject(session.audio) ? session.audio : undefined;
		const input = isPlainObject(audio?.input) ? audio.input : undefined;
		const pick = (nested: string, legacy: string): unknown =>
			input && nested in input ? input[nested] : session[legacy];
		const next: ElevenLabsSessionConfig = { ...this.config };

		const format = pick("format", "input_audio_format");
		if (format !== undefined) {
			const parsed = parseElevenLabsAudioFormat(format);
			if (!parsed.ok) {
				reject(parsed.code, parsed.message);
				return;
			}
			next.format = parsed.value;
		}

		const transcription = pick("transcription", "input_audio_transcription");
		if (transcription !== undefined) {
			if (transcription === null) {
				reject(
					"transcription_model_required",
					"A transcription session cannot disable input audio transcription.",
				);
				return;
			}
			if (!isPlainObject(transcription)) {
				reject(
					"invalid_transcription_config",
					"audio.input.transcription must be an object.",
				);
				return;
			}
			if (
				transcription.model !== undefined &&
				(typeof transcription.model !== "string" ||
					!this.isSessionModel(transcription.model))
			) {
				reject(
					"transcription_model_locked",
					"The transcription model is pinned for this session and cannot be changed.",
				);
				return;
			}
			if (
				Array.isArray(transcription.keywords) &&
				transcription.keywords.length > 0
			) {
				reject(
					"unsupported_parameter",
					"Transcription keywords are billed as a separate ElevenLabs add-on and are not supported for realtime sessions on LLMGateway.",
				);
				return;
			}
			if ("language" in transcription) {
				const { language } = transcription;
				if (language !== null && typeof language !== "string") {
					reject(
						"invalid_transcription_config",
						"transcription.language must be a string or null.",
					);
					return;
				}
				next.language = language || null;
				next.secondaryLanguages = [];
			}
			if (transcription.languages !== undefined) {
				const { languages } = transcription;
				if (
					!Array.isArray(languages) ||
					!languages.every((value) => typeof value === "string" && value)
				) {
					reject(
						"invalid_transcription_config",
						"transcription.languages must be a list of language codes.",
					);
					return;
				}
				const [first, ...rest] = languages as string[];
				next.language = first ?? null;
				next.secondaryLanguages = rest;
			}
			if ("prompt" in transcription) {
				const { prompt } = transcription;
				if (prompt !== null && typeof prompt !== "string") {
					reject(
						"invalid_transcription_config",
						"transcription.prompt must be a string.",
					);
					return;
				}
				next.prompt = prompt ?? "";
			}
		}

		const turnDetection = pick("turn_detection", "turn_detection");
		if (turnDetection !== undefined) {
			const parsed = parseElevenLabsTurnDetection(turnDetection);
			if (!parsed.ok) {
				reject(parsed.code, parsed.message);
				return;
			}
			next.turnDetection = parsed.value;
		}

		const noiseReduction = pick(
			"noise_reduction",
			"input_audio_noise_reduction",
		);
		if (noiseReduction !== undefined) {
			if (noiseReduction !== null && !isPlainObject(noiseReduction)) {
				reject(
					"invalid_noise_reduction",
					"noise_reduction must be an object or null.",
				);
				return;
			}
			next.noiseReduction = noiseReduction;
		}

		// ElevenLabs takes its settings (and the prompt, as the first chunk's
		// previous_text) when the connection opens, so a change reopens it. Its
		// transcription state is not observable beyond partials and commits, so
		// the change waits for those; audio with no transcript yet (usually
		// silence in server VAD) is dropped, like input_audio_buffer.clear.
		const settingsChanged =
			buildElevenLabsUpstreamQuery(next, this.extensionQuery).toString() !==
				buildElevenLabsUpstreamQuery(
					this.config,
					this.extensionQuery,
				).toString() ||
			(this.promptSent && next.prompt !== this.config.prompt);
		if (this.upstream && settingsChanged) {
			if (this.currentItemId !== null || this.commitQueue.length > 0) {
				reject(
					"session_update_in_progress",
					"Audio format, language, prompt, turn detection and noise reduction can only change between transcripts; wait for the pending transcript to complete.",
				);
				return;
			}
			await this.detachUpstream();
			this.resetSegment();
		}
		this.config = next;
		this.sendEvent({ type: "session.updated", session: this.sessionObject() });
	}

	private async handleAppend(
		message: Record<string, unknown>,
		clientEventId: unknown,
	): Promise<void> {
		if (typeof message.audio !== "string") {
			this.sendError(
				"invalid_audio",
				"input_audio_buffer.append requires base64 audio.",
				clientEventId,
			);
			return;
		}
		const audio = Buffer.from(message.audio, "base64");
		if (audio.length === 0) {
			return;
		}
		if (!(await this.authorizeAudio())) {
			return;
		}
		if (!(await this.ensureUpstream())) {
			return;
		}
		const rate = this.upstreamRate!;
		const forwarded = this.forwardToUpstream(
			JSON.stringify({
				message_type: "input_audio_chunk",
				audio_base_64: audio.toString("base64"),
				commit: false,
				sample_rate: rate.sampleRate,
				...(!this.promptSent &&
					this.config.prompt && { previous_text: this.config.prompt }),
			}),
		);
		if (!forwarded) {
			return;
		}
		this.promptSent = true;
		const seconds = audio.length / rate.bytesPerSecond;
		this.unbilledAudioSeconds += seconds;
		this.unbilledAudioBytes += audio.length;
		this.segmentSeconds += seconds;
		this.totalAudioMs += seconds * 1000;

		if (this.unbilledAudioSeconds >= BILLING_INTERVAL_SECONDS) {
			if (await this.billAudio()) {
				this.afterBilling();
			}
		}
	}

	private handleCommit(clientEventId: unknown): void {
		if (
			this.upstream === null ||
			this.upstreamRate === null ||
			this.segmentSeconds < MIN_COMMIT_SECONDS
		) {
			this.sendError(
				"input_audio_buffer_commit_empty",
				`Error committing input audio buffer: buffer too small. Expected at least ${MIN_COMMIT_SECONDS * 1000}ms of audio, but buffer only has ${(this.segmentSeconds * 1000).toFixed(2)}ms of audio.`,
				clientEventId,
			);
			return;
		}
		const forwarded = this.forwardToUpstream(
			JSON.stringify({
				message_type: "input_audio_chunk",
				audio_base_64: "",
				commit: true,
				sample_rate: this.upstreamRate.sampleRate,
			}),
		);
		if (!forwarded) {
			return;
		}
		const itemId = this.currentItemId ?? this.nextItemId();
		this.commitQueue.push({ itemId, seconds: this.segmentSeconds });
		this.sendCommitted(itemId);
		this.resetSegment();
	}

	/**
	 * ElevenLabs has no way to drop uncommitted audio, so clearing reopens the
	 * upstream on the next audio.
	 */
	private async handleClear(clientEventId: unknown): Promise<void> {
		if (this.commitQueue.length > 0) {
			this.sendError(
				"clear_not_available",
				"input_audio_buffer.clear is only available while no committed audio is awaiting its transcript.",
				clientEventId,
			);
			return;
		}
		await this.detachUpstream();
		this.resetSegment();
		this.sendEvent({ type: "input_audio_buffer.cleared" });
	}

	/**
	 * Authorize audio before it reaches the provider: account and credits at
	 * most every REAUTHORIZE_INTERVAL_MS and after every charge, plus one
	 * provider rate-limit request for the whole session.
	 */
	private async authorizeAudio(): Promise<boolean> {
		if (this.finalized || this.closing) {
			return false;
		}
		if (
			this.authorizedAt !== null &&
			Date.now() - this.authorizedAt < REAUTHORIZE_INTERVAL_MS
		) {
			return true;
		}
		const generation = this.chargeGeneration;
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
		if (!(await this.creditsRemain(authorization.organization))) {
			return false;
		}
		if (!this.rateLimitCounted) {
			if (!(await this.rateLimitAllows())) {
				return false;
			}
			this.rateLimitCounted = true;
		}
		if (this.finalized || this.closing) {
			return false;
		}
		this.authorizedAt =
			generation === this.chargeGeneration ? Date.now() : null;
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
		if (available === null) {
			this.refuse(
				"gate_unavailable",
				"Unable to verify account state; audio is temporarily not accepted.",
			);
			return false;
		}
		if (available.lessThanOrEqualTo(0)) {
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
	 * counts as one provider request, counted when audio is first authorized.
	 */
	private async rateLimitAllows(): Promise<boolean> {
		const rateLimit = await checkProviderRateLimit(
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

	// --- Upstream connection ---

	/** Open the upstream with the current session config if none is open. */
	private async ensureUpstream(): Promise<boolean> {
		if (this.upstream && this.upstream.readyState !== WebSocket.OPEN) {
			// Closing, with its close event not handled yet.
			await this.handleUpstreamClose(this.upstream, 1000, "");
			if (this.finalized || this.closing) {
				return false;
			}
		}
		if (this.upstream) {
			return true;
		}
		const query = buildElevenLabsUpstreamQuery(
			this.config,
			this.extensionQuery,
		);
		let upstream: WebSocket;
		try {
			upstream = await this.connect(query);
		} catch (error) {
			logger.warn("ElevenLabs realtime upstream connect failed", {
				sessionId: this.sessionRecordId,
				error: error instanceof Error ? error.message : String(error),
			});
			const known = error instanceof RealtimeConnectError;
			const code = known ? error.code : "upstream_connect_failed";
			this.sendError(
				code,
				known
					? error.message
					: "Failed to connect to the upstream realtime provider.",
				undefined,
				"server_error",
			);
			void this.settleAndShutdown(1011, code);
			return false;
		}
		if (this.finalized || this.closing) {
			discardUpstream(upstream);
			return false;
		}
		this.attachUpstream(upstream);
		return true;
	}

	private attachUpstream(upstream: WebSocket): void {
		this.upstream = upstream;
		this.upstreamRate = elevenLabsAudioRate(this.config.format);
		this.upstreamAlive = true;
		this.upstreamFatal = false;
		this.promptSent = false;

		upstream.on("message", (data) => {
			this.upstreamQueue = this.upstreamQueue
				.then(() => this.handleUpstreamMessage(upstream, data))
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle ElevenLabs realtime upstream message; closing session",
						error as Error,
					);
					void this.settleAndShutdown(1011, "internal_error");
				});
		});
		upstream.on("close", (code, reason) => {
			this.upstreamQueue = this.upstreamQueue.then(() =>
				this.handleUpstreamClose(upstream, code, reason.toString()),
			);
		});
		upstream.on("error", (error) => {
			logger.warn("ElevenLabs realtime upstream socket error", {
				sessionId: this.sessionRecordId,
				error: error.message,
			});
		});
		upstream.on("pong", () => {
			if (this.upstream === upstream) {
				this.upstreamAlive = true;
			}
		});
		// connectUpstream holds incoming messages until listeners attach.
		upstream.resume();
	}

	/** Stop tracking an upstream, including client reads paused for it. */
	private releaseUpstream(upstream: WebSocket): void {
		this.upstream = null;
		this.upstreamRate = null;
		const poller = this.backpressurePollers.get(upstream);
		if (poller) {
			clearInterval(poller);
			this.backpressurePollers.delete(upstream);
			this.resumeClient("backpressure");
		}
	}

	/** Close the upstream on purpose, billing the audio it received. */
	private async detachUpstream(): Promise<void> {
		const upstream = this.upstream;
		if (!upstream) {
			return;
		}
		this.releaseUpstream(upstream);
		try {
			upstream.close(1000);
		} catch {
			upstream.terminate();
		}
		if (await this.billAudio()) {
			this.afterBilling();
		}
	}

	private async handleUpstreamClose(
		upstream: WebSocket,
		code: number,
		rawReason: string,
	): Promise<void> {
		if (this.upstream !== upstream || this.finalized || this.closing) {
			return;
		}
		this.releaseUpstream(upstream);
		const reason = rawReason.trim().slice(0, 90);
		const closeReason = reason
			? `upstream_closed_${code}: ${reason}`
			: `upstream_closed_${code}`;
		if (code !== 1000) {
			logger.warn("ElevenLabs realtime upstream closed the connection", {
				sessionId: this.sessionRecordId,
				code,
				reason,
			});
		}
		this.failPendingItems(
			"upstream_closed",
			"The upstream transcription connection closed before this audio was transcribed.",
		);
		// An item that already produced deltas is completed with its latest
		// partial, so the client is not left waiting for it.
		// handleCommitted resets the segment before billing, during which the
		// client queue may already feed a replacement upstream.
		if (this.currentItemId !== null && this.currentPartial !== "") {
			await this.handleCommitted(this.currentPartial);
			if (this.finalized || this.closing) {
				return;
			}
		} else {
			this.resetSegment();
		}
		if (code !== 1000) {
			this.upstreamFailuresWithoutTranscript += 1;
		}
		if (
			this.upstreamFatal ||
			this.upstreamFailuresWithoutTranscript >
				MAX_UPSTREAM_FAILURES_WITHOUT_TRANSCRIPT
		) {
			if (!this.upstreamFatal) {
				this.sendError(
					"upstream_unavailable",
					"The upstream transcription connection keeps failing.",
					undefined,
					"server_error",
				);
			}
			await this.settleAndShutdown(1011, closeReason);
			return;
		}
		// The next audio reopens the upstream.
		if (await this.billAudio()) {
			this.afterBilling();
		}
	}

	// --- Upstream → client ---

	private async handleUpstreamMessage(
		upstream: WebSocket,
		data: RawData,
	): Promise<void> {
		if (this.upstream !== upstream || this.finalized) {
			return;
		}
		const text = data.toString();
		this.bytesOut += text.length;

		let message: Record<string, unknown>;
		try {
			const parsed = JSON.parse(text) as unknown;
			if (!isPlainObject(parsed)) {
				throw new Error("not an object");
			}
			message = parsed;
		} catch {
			logger.warn("Unparseable ElevenLabs realtime message", {
				sessionId: this.sessionRecordId,
			});
			return;
		}

		const type =
			typeof message.message_type === "string" ? message.message_type : "";
		switch (type) {
			case "session_started":
				if (
					!this.upstreamSessionRecorded &&
					typeof message.session_id === "string"
				) {
					this.upstreamSessionRecorded = true;
					void markRealtimeSessionUpstream(
						this.sessionRecordId,
						message.session_id,
					).catch((error: unknown) => {
						logger.error(
							"Failed to record upstream realtime session id",
							error as Error,
						);
					});
				}
				return;
			case "partial_transcript":
				this.handlePartial(message.text);
				return;
			case "committed_transcript":
				await this.handleCommitted(message.text);
				return;
			default:
				if (typeof message.error === "string") {
					this.handleUpstreamError(type || "error", message.error);
				}
		}
	}

	/**
	 * ElevenLabs sends the whole segment text so far and may revise it; OpenAI
	 * clients append deltas, so only extensions of the text already delivered
	 * are forwarded, and the completed transcript settles any revision.
	 */
	private handlePartial(text: unknown): void {
		if (typeof text !== "string" || text === "") {
			return;
		}
		if (this.currentItemId === null) {
			if (this.commitQueue.length > 0) {
				// Late partial for audio the client already committed; its
				// completed transcript follows.
				return;
			}
			this.currentItemId = this.nextItemId();
			this.currentPartial = "";
			this.deliveredPartial = "";
			if (this.config.turnDetection !== null) {
				const segmentMs = this.segmentSeconds * 1000;
				this.sendEvent({
					type: "input_audio_buffer.speech_started",
					audio_start_ms: Math.max(
						0,
						Math.round(this.totalAudioMs - segmentMs),
					),
					item_id: this.currentItemId,
				});
			}
		}
		this.currentPartial = text;
		if (
			text.length > this.deliveredPartial.length &&
			text.startsWith(this.deliveredPartial)
		) {
			this.sendEvent({
				type: "conversation.item.input_audio_transcription.delta",
				item_id: this.currentItemId,
				content_index: 0,
				delta: text.slice(this.deliveredPartial.length),
			});
			this.deliveredPartial = text;
		}
	}

	private async handleCommitted(text: unknown): Promise<void> {
		const transcript = typeof text === "string" ? text : "";
		let item = this.commitQueue.shift();
		if (!item) {
			// A commit by the upstream's own turn detection.
			if (this.currentItemId === null && transcript.trim() === "") {
				this.segmentSeconds = 0;
				return;
			}
			const itemId = this.currentItemId ?? this.nextItemId();
			item = { itemId, seconds: this.segmentSeconds };
			if (this.config.turnDetection !== null) {
				this.sendEvent({
					type: "input_audio_buffer.speech_stopped",
					audio_end_ms: Math.round(this.totalAudioMs),
					item_id: itemId,
				});
			}
			this.sendCommitted(itemId);
			this.resetSegment();
		}

		// Bill the audio behind the transcript before it is delivered.
		if (!(await this.billAudio())) {
			return;
		}
		this.upstreamFailuresWithoutTranscript = 0;
		this.sendEvent({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: item.itemId,
			content_index: 0,
			transcript,
			usage: { type: "duration", seconds: roundSeconds(item.seconds) },
		});
		this.afterBilling();
	}

	private handleUpstreamError(type: string, message: string): void {
		if (FATAL_UPSTREAM_ERRORS.has(type)) {
			this.upstreamFatal = true;
		}
		const item = COMMIT_ERRORS.has(type) ? this.commitQueue.shift() : undefined;
		if (item) {
			this.sendFailed(item.itemId, type, message);
			return;
		}
		this.sendError(
			type,
			message,
			undefined,
			CLIENT_UPSTREAM_ERRORS.has(type)
				? "invalid_request_error"
				: "server_error",
		);
	}

	private sendCommitted(itemId: string): void {
		this.sendEvent({
			type: "input_audio_buffer.committed",
			previous_item_id: this.lastItemId,
			item_id: itemId,
		});
		this.lastItemId = itemId;
	}

	private sendFailed(itemId: string, code: string, message: string): void {
		this.sendEvent({
			type: "conversation.item.input_audio_transcription.failed",
			item_id: itemId,
			content_index: 0,
			error: { type: "transcription_error", code, message, param: null },
		});
	}

	private failPendingItems(code: string, message: string): void {
		for (const item of this.commitQueue) {
			this.sendFailed(item.itemId, code, message);
		}
		this.commitQueue = [];
	}

	// --- Billing ---

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
		const seconds = this.unbilledAudioSeconds;
		const bytes = this.unbilledAudioBytes;
		if (bytes === 0) {
			return true;
		}
		this.unbilledAudioSeconds = 0;
		this.unbilledAudioBytes = 0;
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
	 * After a charge: close the session at its spend limit, and require a
	 * fresh authorization (account and credits) before the next chunk.
	 */
	private afterBilling(): void {
		if (this.finalized || this.closing) {
			return;
		}
		this.authorizedAt = null;
		this.chargeGeneration += 1;
		if (this.sessionSpend.greaterThanOrEqualTo(maxSessionSpendUsd())) {
			this.refuse(
				"session_spend_limit",
				`This session has reached its spend limit ($${maxSessionSpendUsd()}). Reconnect to start a new session.`,
			);
			void this.settleAndShutdown(1008, "session_spend_limit");
		}
	}

	/** Refuse further audio and log it like a rejected HTTP request. */
	private refuse(code: string, message: string): void {
		this.sendError(code, message);
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
	 * Bill the forwarded audio that no completed transcript has covered — the
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
		const upstream = this.upstream;
		this.upstream = null;
		if (upstream) {
			try {
				if (
					upstream.readyState === WebSocket.OPEN ||
					upstream.readyState === WebSocket.CONNECTING
				) {
					upstream.close(1000);
				}
			} catch {
				upstream.terminate();
			}
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

	private sendEvent(event: Record<string, unknown> & { type: string }): void {
		const { type, ...rest } = event;
		this.sendToClientRaw(
			JSON.stringify({ type, event_id: nextEventId(), ...rest }),
		);
	}

	private sendError(
		code: string,
		message: string,
		clientEventId?: unknown,
		type = "invalid_request_error",
	): void {
		this.sendEvent({
			type: "error",
			error: {
				type,
				code,
				message,
				param: null,
				event_id: typeof clientEventId === "string" ? clientEventId : null,
			},
		});
	}

	private sendToClientRaw(text: string): void {
		if (this.client.readyState !== WebSocket.OPEN) {
			return;
		}
		this.client.send(text);
		if (this.upstream) {
			this.applyBackpressure(this.client, this.upstream);
		}
	}

	/** Returns false when the frame could not be sent. */
	private forwardToUpstream(text: string): boolean {
		const upstream = this.upstream;
		if (!upstream || upstream.readyState !== WebSocket.OPEN) {
			this.sendError(
				"upstream_unavailable",
				"The upstream realtime connection is no longer available.",
				undefined,
				"server_error",
			);
			return false;
		}
		upstream.send(text);
		this.applyBackpressure(upstream, this.client);
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
