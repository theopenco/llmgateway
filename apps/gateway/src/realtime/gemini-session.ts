import { Decimal } from "decimal.js";
import { WebSocket } from "ws";

import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import { getEffectiveDiscount } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { authorizeAccount, availableCredits } from "./account-gate.js";
import {
	closeRealtimeSessionRecord,
	recordRealtimeResponse,
} from "./billing.js";
import { normalizeGeminiRealtimeUsage } from "./gemini-pricing.js";
import {
	LEASE_HEARTBEAT_INTERVAL_MS,
	releaseRealtimeLease,
	renewRealtimeLease,
	type RealtimeLease,
} from "./leases.js";
import {
	applyRealtimeDiscount,
	buildRealtimePriceSnapshot,
	priceRealtimeUsage,
} from "./pricing.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { RawData } from "ws";

const maxSessionMs = () =>
	(Number(process.env.REALTIME_MAX_SESSION_SECONDS) || 3600) * 1000;
const maxSessionSpendUsd = () =>
	process.env.REALTIME_MAX_SESSION_SPEND_USD || "10";
const drainTimeoutMs = () =>
	Number(process.env.REALTIME_DRAIN_TIMEOUT_MS) || 10_000;
const maxBufferedBytes = () =>
	Number(process.env.REALTIME_MAX_BUFFERED_BYTES) || 4 * 1024 * 1024;
const backpressureTimeoutMs = () =>
	Number(process.env.REALTIME_BACKPRESSURE_TIMEOUT_MS) || 30_000;
const pingIntervalMs = () =>
	Number(process.env.REALTIME_PING_INTERVAL_MS) || 15_000;
/**
 * Per-message protocol trace for diagnosing upstream failures. Off by default:
 * it is one debug line per audio chunk (~23/second/session). Logs message
 * kinds and sizes only, never conversation content.
 */
const traceEnabled = () => process.env.REALTIME_GEMINI_TRACE === "true";

/**
 * Gateway-generated errors travel under their own key. Gemini's own error
 * frames use top-level `error`, so reusing that key would make a gateway
 * rejection indistinguishable from a real upstream failure.
 */
function buildGeminiError(code: string, message: string): string {
	return JSON.stringify({ llmgatewayError: { code, message } });
}

/**
 * The four client message types of BidiGenerateContentClientMessage. Exactly
 * one may be present per frame.
 */
const CLIENT_MESSAGE_KEYS = [
	"setup",
	"clientContent",
	"realtimeInput",
	"toolResponse",
] as const;

const REALTIME_INPUT_KEYS = new Set([
	"audio",
	"text",
	"activityStart",
	"activityEnd",
	"audioStreamEnd",
]);

/**
 * Keys that carry inline or referenced binary media. Rejected anywhere in
 * client content or a function response payload: only text, PCM audio through
 * realtimeInput, and function results are metered by this gateway.
 */
const MEDIA_KEYS = new Set([
	"inlineData",
	"inline_data",
	"fileData",
	"file_data",
]);

const MEDIA_SCAN_MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Depth-bounded scan for embedded media references inside an arbitrary JSON
 * payload (a function response body). Anything deeper than the cap is treated
 * as media-bearing rather than assumed clean.
 */
function containsEmbeddedMedia(value: unknown, depth = 0): boolean {
	if (depth > MEDIA_SCAN_MAX_DEPTH) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some((entry) => containsEmbeddedMedia(entry, depth + 1));
	}
	if (!isPlainObject(value)) {
		return false;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (MEDIA_KEYS.has(key)) {
			return true;
		}
		if (containsEmbeddedMedia(nested, depth + 1)) {
			return true;
		}
	}
	return false;
}

export interface GeminiRealtimeProxySessionOptions {
	clientSocket: WebSocket;
	upstreamSocket: WebSocket;
	preflight: RealtimePreflightResult;
	gatewayToken: string;
	requestedModel: string;
	sessionRecordId: string;
	lease: RealtimeLease;
	source: string | null;
	userAgent: string | undefined;
	/**
	 * Instructions pinned by the client secret, applied to
	 * setup.systemInstruction and locked against a client-supplied one.
	 */
	pinnedInstructions: string | null;
	/**
	 * Output voice pinned by the client secret, applied as the session default
	 * (setup.generationConfig.speechConfig) when the client did not choose one.
	 */
	pinnedVoice: string | null;
	onClosed: (session: GeminiRealtimeProxySession) => void;
}

/**
 * One active Gemini Live session: a client WebSocket bridged to Google's
 * BidiGenerateContent WebSocket. Gemini's native wire protocol is preserved in
 * both directions — no translation to or from the OpenAI realtime protocol —
 * while the gateway still validates the protocol, bills every generation stage
 * from `usageMetadata` before its terminal event is delivered, and re-runs the
 * account gates after each charge.
 */
export class GeminiRealtimeProxySession {
	private readonly client: WebSocket;
	private readonly upstream: WebSocket;
	private readonly preflight: RealtimePreflightResult;
	private readonly gatewayToken: string;
	private readonly requestedModel: string;
	public readonly sessionRecordId: string;
	private readonly lease: RealtimeLease;
	private readonly source: string | null;
	private readonly userAgent: string | undefined;
	private readonly pinnedInstructions: string | null;
	private readonly pinnedVoice: string | null;
	private readonly onClosed: (session: GeminiRealtimeProxySession) => void;

	private readonly openedAt = Date.now();
	private bytesIn = 0;
	private bytesOut = 0;
	private sessionSpend = new Decimal(0);

	// Setup handshake state: exactly one setup message, and nothing else until
	// the upstream acknowledges it with setupComplete.
	private setupSent = false;
	private setupComplete = false;

	// --- Generation stage tracking ---
	// Gemini reports usage per generation stage rather than per response id, so
	// the latest snapshot is buffered and charged once at the stage's terminal
	// event (a toolCall, or a serverContent carrying turnComplete).
	private pendingUsage: unknown = null;
	private stageInterrupted = false;
	private stageStartedAt: number | null = null;
	// Whether the model is mid-turn. Driven by what the provider is actually
	// doing, NOT by what the client sent: client audio only means speech was
	// streamed, and treating that as a live generation makes every disconnect
	// wait out the full drain timeout.
	private generationInProgress = false;
	// Audio streamed since the last completed turn, which the provider may still
	// turn into a billable generation after the client goes away.
	private uncommittedAudio = false;
	private billedStages = 0;

	// --- Diagnostics ---
	// Gemini reports fatal problems by closing the socket with an opaque reason
	// ("Internal error encountered."), so the surrounding session state is the
	// only material available to correlate failures. Counters only — no audio,
	// transcripts or resumption handles.
	private clientMessageCounts: Record<string, number> = {};
	private upstreamMessageCounts: Record<string, number> = {};
	private audioChunksIn = 0;
	private lastClientMessageKind: string | null = null;
	private lastClientMessageAt: number | null = null;
	private lastUpstreamMessageKind: string | null = null;
	private lastUpstreamMessageAt: number | null = null;

	// Set while the post-billing gates run. Client messages that could trigger
	// another generation wait for it, so a session that just lost its
	// authorization cannot start one more turn in the gap.
	private postBillingGate: Promise<void> = Promise.resolve();

	private finalized = false;
	private draining = false;

	private clientAlive = true;
	private upstreamAlive = true;
	private readonly timers: NodeJS.Timeout[] = [];
	private backpressurePoller: NodeJS.Timeout | null = null;
	private drainTimer: NodeJS.Timeout | null = null;
	// Handling is asynchronous on the billing-critical paths, so frames are
	// chained rather than dispatched concurrently: otherwise a later frame
	// overtakes the one still awaiting and reaches the peer out of order.
	private clientQueue: Promise<void> = Promise.resolve();
	private upstreamQueue: Promise<void> = Promise.resolve();

	public constructor(options: GeminiRealtimeProxySessionOptions) {
		this.client = options.clientSocket;
		this.upstream = options.upstreamSocket;
		this.preflight = options.preflight;
		this.gatewayToken = options.gatewayToken;
		this.requestedModel = options.requestedModel;
		this.sessionRecordId = options.sessionRecordId;
		this.lease = options.lease;
		this.source = options.source;
		this.userAgent = options.userAgent;
		this.pinnedInstructions = options.pinnedInstructions;
		this.pinnedVoice = options.pinnedVoice;
		this.onClosed = options.onClosed;

		this.client.on("message", (data, isBinary) => {
			this.clientQueue = this.clientQueue
				.then(() => this.handleClientMessage(data, isBinary))
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle Gemini realtime client message; closing session",
						error as Error,
					);
					this.shutdown(1011, "internal_error");
				});
		});
		this.upstream.on("message", (data) => {
			this.upstreamQueue = this.upstreamQueue
				.then(() => this.handleUpstreamMessage(data))
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle Gemini realtime upstream message; closing session",
						error as Error,
					);
					this.shutdown(1011, "internal_error");
				});
		});

		this.client.on("close", () => {
			void this.handleClientClose();
		});
		this.upstream.on("close", (code, reason) => {
			// Queued behind the message stream so the close cannot bill a tail that
			// an in-flight terminal event is already charging.
			const upstreamReason = reason.toString();
			this.upstreamQueue = this.upstreamQueue
				.then(() => this.handleUpstreamClose(code, upstreamReason))
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle Gemini realtime upstream close",
						error as Error,
					);
					this.shutdown(1011, "internal_error");
				});
		});
		this.client.on("error", (error) => {
			logger.warn("Gemini realtime client socket error", {
				sessionId: this.sessionRecordId,
				error: error.message,
			});
		});
		this.upstream.on("error", (error) => {
			logger.warn("Gemini realtime upstream socket error", {
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
					buildGeminiError(
						"session_duration_limit",
						"Maximum realtime session duration reached. Reconnect to continue.",
					),
				);
				this.settleAndShutdown(1000, "session_duration_limit");
			}, maxSessionMs()),
		);

		const ping = setInterval(() => {
			if (!this.clientAlive || !this.upstreamAlive) {
				this.settleAndShutdown(1011, "ping_timeout");
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
		}, pingIntervalMs());
		this.timers.push(ping);

		const heartbeat = setInterval(() => {
			void renewRealtimeLease(this.lease);
		}, LEASE_HEARTBEAT_INTERVAL_MS);
		this.timers.push(heartbeat);
	}

	// --- Client → upstream ---

	private async handleClientMessage(
		data: RawData,
		isBinary: boolean,
	): Promise<void> {
		const size = Buffer.isBuffer(data)
			? data.length
			: Array.isArray(data)
				? data.reduce((sum, b) => sum + b.length, 0)
				: data.byteLength;
		this.bytesIn += size;

		if (isBinary) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_frame",
					"Binary frames are not supported; send JSON messages.",
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
				buildGeminiError(
					"invalid_json",
					"Client message is not a JSON object.",
				),
			);
			return;
		}

		const present = CLIENT_MESSAGE_KEYS.filter(
			(key) => message[key] !== undefined && message[key] !== null,
		);
		if (present.length !== 1) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_client_message",
					`Each client message must carry exactly one of ${CLIENT_MESSAGE_KEYS.join(", ")}.`,
				),
			);
			return;
		}
		const kind = present[0];

		if (kind === "setup") {
			this.handleSetup(message.setup);
			return;
		}
		if (!this.setupComplete) {
			this.sendToClientRaw(
				buildGeminiError(
					"setup_required",
					"Send a setup message and wait for setupComplete before sending anything else.",
				),
			);
			return;
		}

		switch (kind) {
			case "clientContent":
				await this.handleClientContent(message.clientContent);
				return;
			case "realtimeInput":
				await this.handleRealtimeInput(message.realtimeInput);
				return;
			case "toolResponse":
				await this.handleToolResponse(message.toolResponse);
		}
	}

	private handleSetup(rawSetup: unknown): void {
		if (this.setupSent) {
			this.sendToClientRaw(
				buildGeminiError(
					"setup_already_sent",
					"The session is already configured; setup may only be sent once.",
				),
			);
			return;
		}
		if (!isPlainObject(rawSetup)) {
			this.sendToClientRaw(
				buildGeminiError("invalid_setup", "setup must be an object."),
			);
			return;
		}

		// Raw-protocol nesting is validated rather than silently corrected: a
		// misplaced field would otherwise be dropped by Google and the caller
		// would get a text-only or default-voice session with no explanation.
		if (rawSetup.responseModalities !== undefined) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_setup_nesting",
					"responseModalities belongs under setup.generationConfig.",
				),
			);
			return;
		}
		if (rawSetup.speechConfig !== undefined) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_setup_nesting",
					"speechConfig belongs under setup.generationConfig.",
				),
			);
			return;
		}
		if (rawSetup.cachedContent !== undefined) {
			this.sendToClientRaw(
				buildGeminiError(
					"cached_content_not_supported",
					"Stored context caches are not supported for realtime sessions on LLMGateway. Inline the context instead.",
				),
			);
			return;
		}

		const generationConfig = rawSetup.generationConfig;
		if (generationConfig !== undefined && !isPlainObject(generationConfig)) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_setup",
					"setup.generationConfig must be an object.",
				),
			);
			return;
		}
		if (
			generationConfig?.inputAudioTranscription !== undefined ||
			generationConfig?.outputAudioTranscription !== undefined
		) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_setup_nesting",
					"inputAudioTranscription and outputAudioTranscription are top-level setup fields, not generationConfig fields.",
				),
			);
			return;
		}

		const modalities = generationConfig?.responseModalities;
		if (
			!Array.isArray(modalities) ||
			modalities.length === 0 ||
			!modalities.every((entry) => entry === "AUDIO")
		) {
			this.sendToClientRaw(
				buildGeminiError(
					"audio_modality_required",
					'Realtime sessions on LLMGateway are speech-to-speech: setup.generationConfig.responseModalities must be ["AUDIO"].',
				),
			);
			return;
		}

		if (
			rawSetup.tools !== undefined &&
			!this.validateSetupTools(rawSetup.tools)
		) {
			return;
		}

		// Rejected rather than overwritten, so a caller that believes it
		// configured the prompt learns that it did not.
		if (
			this.pinnedInstructions !== null &&
			rawSetup.systemInstruction !== undefined
		) {
			this.sendToClientRaw(
				buildGeminiError(
					"instructions_locked",
					"The session instructions were pinned when this session's client secret was created and cannot be changed via setup.systemInstruction.",
				),
			);
			return;
		}

		// The model is pinned at connection time; whatever the caller sent is
		// replaced with the mapping's upstream id.
		const setup: Record<string, unknown> = {
			...rawSetup,
			model: `models/${this.preflight.match.mapping.externalId}`,
		};
		if (this.pinnedInstructions !== null) {
			setup.systemInstruction = {
				parts: [{ text: this.pinnedInstructions }],
			};
		}
		if (this.pinnedVoice !== null) {
			setup.generationConfig = this.withPinnedVoice(rawSetup.generationConfig);
		}
		this.setupSent = true;
		this.forwardToUpstream(JSON.stringify({ setup }));
	}

	/**
	 * Merge the pinned voice into setup.generationConfig.speechConfig. The voice
	 * is a default rather than a lock, so an explicit client voiceName wins.
	 */
	private withPinnedVoice(
		rawGenerationConfig: unknown,
	): Record<string, unknown> {
		const generationConfig: Record<string, unknown> = isPlainObject(
			rawGenerationConfig,
		)
			? { ...rawGenerationConfig }
			: {};
		const speechConfig: Record<string, unknown> = isPlainObject(
			generationConfig.speechConfig,
		)
			? { ...generationConfig.speechConfig }
			: {};
		const voiceConfig: Record<string, unknown> = isPlainObject(
			speechConfig.voiceConfig,
		)
			? { ...speechConfig.voiceConfig }
			: {};
		const prebuiltVoiceConfig: Record<string, unknown> = isPlainObject(
			voiceConfig.prebuiltVoiceConfig,
		)
			? { ...voiceConfig.prebuiltVoiceConfig }
			: {};
		if (typeof prebuiltVoiceConfig.voiceName === "string") {
			return generationConfig;
		}
		prebuiltVoiceConfig.voiceName = this.pinnedVoice;
		voiceConfig.prebuiltVoiceConfig = prebuiltVoiceConfig;
		speechConfig.voiceConfig = voiceConfig;
		generationConfig.speechConfig = speechConfig;
		return generationConfig;
	}

	/**
	 * Only inline function declarations are allowed. Hosted tools (Google
	 * Search, code execution, URL context, file search, computer use) and
	 * provider-managed resources carry separate fees that this gateway does not
	 * meter, and they never appear in `usageMetadata` as a priceable modality.
	 */
	private validateSetupTools(tools: unknown): boolean {
		const reject = () => {
			this.sendToClientRaw(
				buildGeminiError(
					"tool_type_not_supported",
					"Only inline function declarations are supported for realtime sessions on LLMGateway. Hosted tools (Google Search, code execution, URL context, etc.) are not yet available.",
				),
			);
			return false;
		};
		if (!Array.isArray(tools)) {
			return reject();
		}
		for (const tool of tools) {
			if (!isPlainObject(tool)) {
				return reject();
			}
			const keys = Object.keys(tool);
			if (keys.length !== 1 || keys[0] !== "functionDeclarations") {
				return reject();
			}
			if (!Array.isArray(tool.functionDeclarations)) {
				return reject();
			}
		}
		return true;
	}

	private async handleClientContent(rawContent: unknown): Promise<void> {
		if (!isPlainObject(rawContent)) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_client_content",
					"clientContent must be an object.",
				),
			);
			return;
		}
		const turns = rawContent.turns;
		if (turns !== undefined) {
			if (!Array.isArray(turns)) {
				this.sendToClientRaw(
					buildGeminiError(
						"invalid_client_content",
						"clientContent.turns must be an array.",
					),
				);
				return;
			}
			for (const turn of turns) {
				if (!isPlainObject(turn) || !Array.isArray(turn.parts)) {
					this.sendToClientRaw(
						buildGeminiError(
							"invalid_client_content",
							"Each clientContent turn must be an object with a parts array.",
						),
					);
					return;
				}
				for (const part of turn.parts) {
					if (
						!isPlainObject(part) ||
						Object.keys(part).length !== 1 ||
						typeof part.text !== "string"
					) {
						this.sendToClientRaw(
							buildGeminiError(
								"content_type_not_supported",
								"Only text parts are supported in clientContent. Send audio through realtimeInput; image, video, and file parts are not yet supported.",
							),
						);
						return;
					}
				}
			}
		}

		await this.postBillingGate;
		if (this.clientGone()) {
			return;
		}
		this.markStageStarted();
		this.recordClientMessage("clientContent", false);
		this.forwardToUpstream(JSON.stringify({ clientContent: rawContent }));
	}

	private async handleRealtimeInput(rawInput: unknown): Promise<void> {
		if (!isPlainObject(rawInput)) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_realtime_input",
					"realtimeInput must be an object.",
				),
			);
			return;
		}
		if (rawInput.video !== undefined) {
			this.sendToClientRaw(
				buildGeminiError(
					"video_input_not_supported",
					"Video input is not supported for realtime sessions on LLMGateway.",
				),
			);
			return;
		}
		if (rawInput.mediaChunks !== undefined) {
			this.sendToClientRaw(
				buildGeminiError(
					"media_chunks_not_supported",
					"realtimeInput.mediaChunks is deprecated and not supported; send PCM audio through realtimeInput.audio.",
				),
			);
			return;
		}
		for (const key of Object.keys(rawInput)) {
			if (!REALTIME_INPUT_KEYS.has(key)) {
				this.sendToClientRaw(
					buildGeminiError(
						"invalid_realtime_input",
						`Unsupported realtimeInput field: ${key}`,
					),
				);
				return;
			}
		}
		if (rawInput.audio !== undefined) {
			const audio = rawInput.audio;
			if (
				!isPlainObject(audio) ||
				typeof audio.data !== "string" ||
				typeof audio.mimeType !== "string" ||
				!audio.mimeType.startsWith("audio/pcm")
			) {
				this.sendToClientRaw(
					buildGeminiError(
						"invalid_audio_blob",
						"realtimeInput.audio must be a PCM blob with data and an audio/pcm mimeType.",
					),
				);
				return;
			}
		}

		await this.postBillingGate;
		if (this.clientGone()) {
			return;
		}
		if (rawInput.audio !== undefined) {
			this.uncommittedAudio = true;
		}
		if (
			rawInput.audio !== undefined ||
			rawInput.text !== undefined ||
			rawInput.audioStreamEnd === true ||
			rawInput.activityEnd !== undefined
		) {
			this.markStageStarted();
		}
		this.recordClientMessage(
			rawInput.audio !== undefined
				? "realtimeInput.audio"
				: rawInput.audioStreamEnd === true
					? "realtimeInput.audioStreamEnd"
					: rawInput.text !== undefined
						? "realtimeInput.text"
						: "realtimeInput.activity",
			rawInput.audio !== undefined,
		);
		this.forwardToUpstream(JSON.stringify({ realtimeInput: rawInput }));
	}

	private async handleToolResponse(rawResponse: unknown): Promise<void> {
		if (!isPlainObject(rawResponse)) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_tool_response",
					"toolResponse must be an object.",
				),
			);
			return;
		}
		const functionResponses = rawResponse.functionResponses;
		if (!Array.isArray(functionResponses)) {
			this.sendToClientRaw(
				buildGeminiError(
					"invalid_tool_response",
					"toolResponse.functionResponses must be an array.",
				),
			);
			return;
		}
		for (const entry of functionResponses) {
			if (!isPlainObject(entry)) {
				this.sendToClientRaw(
					buildGeminiError(
						"invalid_tool_response",
						"Each function response must be an object.",
					),
				);
				return;
			}
			if (entry.parts !== undefined || containsEmbeddedMedia(entry.response)) {
				this.sendToClientRaw(
					buildGeminiError(
						"content_type_not_supported",
						"Function responses may not carry inline or referenced media; return text or JSON values instead.",
					),
				);
				return;
			}
		}

		await this.postBillingGate;
		if (this.clientGone()) {
			return;
		}
		this.markStageStarted();
		this.recordClientMessage("toolResponse", false);
		this.forwardToUpstream(JSON.stringify({ toolResponse: rawResponse }));
	}

	/**
	 * Start the clock for a generation stage the client just asked for. This
	 * deliberately does NOT mark a generation as in progress — only the provider
	 * can tell us that.
	 */
	private markStageStarted(): void {
		this.stageStartedAt ??= Date.now();
	}

	private recordClientMessage(kind: string, audioChunk: boolean): void {
		this.clientMessageCounts[kind] = (this.clientMessageCounts[kind] ?? 0) + 1;
		this.lastClientMessageKind = kind;
		this.lastClientMessageAt = Date.now();
		if (audioChunk) {
			this.audioChunksIn += 1;
		}
		if (traceEnabled()) {
			logger.debug("Gemini realtime client → upstream", {
				sessionId: this.sessionRecordId,
				kind,
			});
		}
	}

	private recordUpstreamMessage(kind: string, byteLength: number): void {
		this.upstreamMessageCounts[kind] =
			(this.upstreamMessageCounts[kind] ?? 0) + 1;
		this.lastUpstreamMessageKind = kind;
		this.lastUpstreamMessageAt = Date.now();
		if (traceEnabled()) {
			logger.debug("Gemini realtime upstream → client", {
				sessionId: this.sessionRecordId,
				kind,
				bytes: byteLength,
			});
		}
	}

	/**
	 * Session state worth attaching to a failure. Message kinds and counters
	 * only: conversation content is never logged for realtime sessions.
	 */
	private diagnostics(): Record<string, unknown> {
		const now = Date.now();
		return {
			sessionAgeMs: now - this.openedAt,
			setupComplete: this.setupComplete,
			generationInProgress: this.generationInProgress,
			uncommittedAudio: this.uncommittedAudio,
			stageInterrupted: this.stageInterrupted,
			billedStages: this.billedStages,
			hasPendingUsage: this.pendingUsage !== null,
			audioChunksIn: this.audioChunksIn,
			bytesIn: this.bytesIn,
			bytesOut: this.bytesOut,
			clientMessageCounts: this.clientMessageCounts,
			upstreamMessageCounts: this.upstreamMessageCounts,
			lastClientMessageKind: this.lastClientMessageKind,
			msSinceLastClientMessage: this.lastClientMessageAt
				? now - this.lastClientMessageAt
				: null,
			lastUpstreamMessageKind: this.lastUpstreamMessageKind,
			msSinceLastUpstreamMessage: this.lastUpstreamMessageAt
				? now - this.lastUpstreamMessageAt
				: null,
		};
	}

	/**
	 * True once the client has gone away: the session is draining its billable
	 * tail or has already been finalized.
	 */
	private clientGone(): boolean {
		return this.draining || this.finalized;
	}

	// --- Upstream → client ---

	private async handleUpstreamMessage(data: RawData): Promise<void> {
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
			// The upstream protocol is JSON-only; an unparseable frame means we can
			// no longer trust the billing-critical message stream.
			logger.error("Unparseable Gemini realtime upstream message", {
				sessionId: this.sessionRecordId,
			});
			this.shutdown(1011, "upstream_protocol_error");
			return;
		}

		this.recordUpstreamMessage(
			message.setupComplete !== undefined
				? "setupComplete"
				: message.toolCall !== undefined
					? "toolCall"
					: message.serverContent !== undefined
						? "serverContent"
						: message.goAway !== undefined
							? "goAway"
							: message.sessionResumptionUpdate !== undefined
								? "sessionResumptionUpdate"
								: message.toolCallCancellation !== undefined
									? "toolCallCancellation"
									: message.error !== undefined
										? "error"
										: "other",
			text.length,
		);

		// usageMetadata rides alongside the message's payload field, so buffer it
		// before dispatching on that payload: a snapshot delivered with the same
		// frame as the stage's terminal event must be the one that is charged.
		if (message.usageMetadata !== undefined) {
			this.pendingUsage = message.usageMetadata;
		}

		if (message.setupComplete !== undefined) {
			this.setupComplete = true;
			this.sendToClientRaw(text);
			return;
		}

		// Only the provider can say a generation is under way, so this is where
		// the drain condition is armed.
		if (
			message.serverContent !== undefined ||
			message.toolCall !== undefined ||
			message.usageMetadata !== undefined
		) {
			this.generationInProgress = true;
		}

		if (message.toolCall !== undefined) {
			// A function-call stage is terminal for billing: the model has produced
			// its output and now waits for the client's tool result.
			const billed = await this.billStage("completed", { requireUsage: true });
			if (!billed) {
				return;
			}
			this.sendToClientRaw(text);
			this.afterTerminalEvent();
			return;
		}

		const serverContent = isPlainObject(message.serverContent)
			? message.serverContent
			: undefined;
		if (serverContent) {
			if (serverContent.interrupted === true) {
				this.stageInterrupted = true;
			}
			if (serverContent.turnComplete === true) {
				const billed = await this.billStage(
					this.stageInterrupted ? "cancelled" : "completed",
					{ requireUsage: false },
				);
				if (!billed) {
					return;
				}
				this.sendToClientRaw(text);
				this.afterTerminalEvent();
				return;
			}
		}

		// Session resumption handles are bearer credentials for the conversation,
		// not identifiers: they are forwarded so a caller can use them, but never
		// persisted or logged.
		this.sendToClientRaw(text);
	}

	/**
	 * Charge the buffered usage snapshot for the generation stage that is about
	 * to terminate, BEFORE its terminal message reaches the client. Returns
	 * false when the session was closed instead (the caller must not forward).
	 *
	 * Gemini charges every generation for its complete active prompt, retained
	 * conversation history included, so the snapshot is billed as reported — no
	 * previous-turn subtraction.
	 */
	private async billStage(
		status: "completed" | "cancelled",
		options: { requireUsage: boolean },
	): Promise<boolean> {
		const rawUsage = this.pendingUsage;
		this.pendingUsage = null;

		if (rawUsage === null || rawUsage === undefined) {
			if (options.requireUsage) {
				logger.error(
					"Gemini realtime generation stage without usage metadata",
					{
						sessionId: this.sessionRecordId,
					},
				);
				this.shutdown(1011, "unbillable_generation");
				return false;
			}
			// A terminal event with nothing left to charge — most commonly the
			// turnComplete that closes a stage already billed at its toolCall. No
			// log row, but the account gates still re-run.
			return true;
		}

		const normalized = normalizeGeminiRealtimeUsage(rawUsage);
		if (!normalized.ok) {
			logger.error(`Unpriceable Gemini realtime usage: ${normalized.reason}`, {
				sessionId: this.sessionRecordId,
				usage: rawUsage,
			});
			this.shutdown(1011, `unpriceable_usage:${normalized.reason}`);
			return false;
		}
		if (!normalized.billable) {
			return true;
		}

		const snapshot = buildRealtimePriceSnapshot(this.preflight.match.mapping);
		const priced = priceRealtimeUsage(normalized.usage, snapshot);
		if (!priced.ok) {
			logger.error(`Unpriceable Gemini realtime usage: ${priced.reason}`, {
				sessionId: this.sessionRecordId,
				usage: normalized.usage,
			});
			this.shutdown(1011, `unpriceable_usage:${priced.reason}`);
			return false;
		}

		// getEffectiveDiscount swallows its own database errors and returns a 0%
		// discount, so a lookup outage bills at full price rather than reaching
		// this catch; the catch only covers unexpected throws.
		let discount: Decimal;
		try {
			const effectiveDiscount = await getEffectiveDiscount(
				this.preflight.project.organizationId,
				this.preflight.match.mapping.providerId,
				this.preflight.match.modelId,
			);
			discount = new Decimal(effectiveDiscount.discount);
		} catch (error) {
			logger.error(
				"Failed to resolve Gemini realtime discount; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return false;
		}
		const discountedCosts = applyRealtimeDiscount(priced.costs, discount);

		// Gemini supplies no response identifier, so stages are numbered per
		// session. Combined with the session id this is still a stable
		// idempotency key for the partial unique index.
		this.billedStages += 1;
		const responseId = `gusage-${this.billedStages}`;
		const durationMs = this.stageStartedAt
			? Date.now() - this.stageStartedAt
			: 0;
		try {
			const { inserted } = await recordRealtimeResponse({
				preflight: this.preflight,
				sessionId: this.sessionRecordId,
				requestedModel: this.requestedModel,
				responseId,
				responseStatus: status,
				durationMs,
				responseSizeBytes: JSON.stringify(rawUsage).length,
				usage: normalized.usage,
				costs: discountedCosts,
				pricingSnapshot: snapshot,
				discount: discount.toNumber(),
				source: this.source,
				userAgent: this.userAgent,
			});
			if (inserted) {
				this.sessionSpend = this.sessionSpend.plus(discountedCosts.totalCost);
			}
		} catch (error) {
			logger.error(
				"Failed to persist Gemini realtime billing event; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return false;
		}

		return true;
	}

	/**
	 * Reset per-stage state once a terminal event has been billed and
	 * forwarded, then re-run the account gates. The gate promise is published
	 * first so a client message that arrives while it is still running waits
	 * for the verdict instead of racing another generation past it.
	 */
	private afterTerminalEvent(): void {
		this.stageInterrupted = false;
		this.stageStartedAt = null;
		this.generationInProgress = false;
		// The streamed audio that fed this turn has been consumed by it. Leaving
		// this set would make every later disconnect drain for nothing.
		this.uncommittedAudio = false;

		if (this.draining) {
			this.maybeFinishDrain();
			return;
		}
		// A gate that throws must not leave a rejected promise for the next client
		// message to await (and must not surface as an unhandled rejection): fail
		// the session closed instead.
		this.postBillingGate = this.enforceLimitsAfterGeneration().catch(
			(error: unknown) => {
				logger.error(
					"Gemini realtime post-billing gate failed; closing session",
					error as Error,
				);
				this.shutdown(1011, "internal_error");
			},
		);
	}

	/**
	 * Gemini generates reactively — there is no client event the gateway can
	 * gate before the provider starts working — so authorization is re-run
	 * immediately after each charge instead. A session that no longer clears
	 * the gates is closed, so an exhausted or revoked account can overrun by at
	 * most the one generation it already incurred.
	 *
	 * Every failure closes the session: unlike a gated response.create there is
	 * no single unit of work left to refuse. Only an unreadable account state
	 * is tolerated, matching the OpenAI path, so a transient database error
	 * does not drop live calls.
	 */
	private async enforceLimitsAfterGeneration(): Promise<void> {
		if (this.finalized) {
			return;
		}
		if (this.sessionSpend.greaterThanOrEqualTo(maxSessionSpendUsd())) {
			this.sendToClientRaw(
				buildGeminiError(
					"session_spend_limit",
					`This session has reached its spend limit ($${maxSessionSpendUsd()}). Reconnect to start a new session.`,
				),
			);
			this.shutdown(1008, "session_spend_limit");
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
			this.sendToClientRaw(
				buildGeminiError(authorization.code, authorization.message),
			);
			this.shutdown(1008, authorization.code);
			return;
		}

		if (this.preflight.usedMode === "credits") {
			const available = await availableCredits(
				this.preflight.project.organizationId,
				authorization.organization,
			);
			if (available !== null && available.lessThanOrEqualTo(0)) {
				this.sendToClientRaw(
					buildGeminiError(
						"insufficient_credits",
						"Organization has insufficient credits to continue this session.",
					),
				);
				this.shutdown(1008, "insufficient_credits");
				return;
			}
		}

		const rateLimit = await checkProviderRateLimit(
			this.preflight.project.organizationId,
			this.preflight.match.mapping.providerId,
			this.preflight.match.modelId,
		);
		if (!rateLimit.allowed) {
			this.sendToClientRaw(
				buildGeminiError(
					"rate_limit_exceeded",
					`Provider rate limit exceeded${rateLimit.retryAfter ? `; retry after ${rateLimit.retryAfter}s` : ""}.`,
				),
			);
			this.shutdown(1008, "rate_limit_exceeded");
		}
	}

	/**
	 * Finish a client-initiated drain once the billable tail has been captured.
	 */
	private maybeFinishDrain(): void {
		if (this.draining && !this.generationInProgress) {
			this.shutdown(1000, "client_disconnected");
		}
	}

	/**
	 * Close the session, first charging a generation stage whose usage snapshot
	 * has arrived but whose terminal event never will. Every locally initiated
	 * shutdown goes through here — a timer, a dead socket, a process drain —
	 * because the provider has already charged for that work and dropping the
	 * snapshot silently underbills it. The upstream-close path does the same
	 * thing inline.
	 *
	 * Nothing recurses: billStage() takes the snapshot before doing anything
	 * else, so the shutdown it performs on failure re-enters here with no
	 * pending usage left and falls straight through to the hard stop.
	 */
	private settleAndShutdown(code: number, reason: string): void {
		if (this.finalized || this.pendingUsage === null) {
			this.shutdown(code, reason);
			return;
		}
		// Serialized behind the upstream queue so a terminal event racing this
		// cannot charge the same snapshot twice under two stage numbers.
		this.upstreamQueue = this.upstreamQueue
			.then(async () => {
				await this.billStage("cancelled", { requireUsage: false });
				this.shutdown(code, reason);
			})
			.catch((error: unknown) => {
				logger.error(
					"Failed to charge the trailing Gemini realtime stage",
					error as Error,
				);
				this.shutdown(code, reason);
			});
	}

	/**
	 * Force-close from outside (server drain). Charges any buffered stage first.
	 */
	public close(code: number, reason: string): void {
		this.settleAndShutdown(code, reason);
	}

	// --- Lifecycle ---

	private async handleClientClose(): Promise<void> {
		if (this.finalized || this.draining) {
			return;
		}
		if (
			(this.generationInProgress || this.uncommittedAudio) &&
			this.upstream.readyState === WebSocket.OPEN
		) {
			// Keep the upstream open briefly to capture the terminal usage the
			// provider is going to charge us for anyway. Closing the audio stream
			// makes Gemini commit whatever it has and finish the turn instead of
			// waiting for more input that will never arrive.
			this.draining = true;
			this.forwardToUpstream(
				JSON.stringify({ realtimeInput: { audioStreamEnd: true } }),
			);
			this.uncommittedAudio = false;
			this.drainTimer = setTimeout(() => {
				// Expected when the provider had nothing left to finish; loud enough
				// to notice if it becomes the normal way sessions end, which would
				// mean billable tails are being dropped.
				logger.warn("Gemini realtime drain timed out", {
					sessionId: this.sessionRecordId,
					...this.diagnostics(),
				});
				this.settleAndShutdown(1000, "client_disconnected_drain_timeout");
			}, drainTimeoutMs());
			return;
		}
		this.shutdown(1000, "client_disconnected");
	}

	/**
	 * Gemini rejects a bad credential, an unknown model or a malformed setup by
	 * closing the socket with a status code and a human-readable reason rather
	 * than by sending an error message. That reason is the only diagnosis a
	 * caller or operator gets, so it is logged and carried into the client's own
	 * close reason instead of being dropped for a bare "upstream_closed_1007".
	 */
	private async handleUpstreamClose(
		code: number,
		upstreamReason: string,
	): Promise<void> {
		if (this.finalized) {
			return;
		}
		if (code !== 1000) {
			// Logged before billing so the diagnosis survives even if charging the
			// tail is what ends up closing the session.
			logger.error("Gemini realtime upstream closed the session", {
				sessionId: this.sessionRecordId,
				code,
				reason: upstreamReason,
				model: this.preflight.match.modelId,
				...this.diagnostics(),
			});
		}
		// A disconnect mid-generation still leaves a snapshot of work the provider
		// has already charged us for, and the terminal event that would normally
		// close the stage is never going to arrive. Charge it here or it is lost.
		const billed = await this.billStage("cancelled", { requireUsage: false });
		if (!billed) {
			return;
		}
		if (code === 1000) {
			this.shutdown(1000, "upstream_closed");
			return;
		}
		const detail = upstreamReason.trim().slice(0, 90);
		this.shutdown(
			1011,
			detail ? `upstream_closed_${code}: ${detail}` : `upstream_closed_${code}`,
		);
	}

	/**
	 * Close both sockets and finalize the session record. Idempotent.
	 */
	public shutdown(code: number, reason: string): void {
		if (this.finalized) {
			return;
		}
		this.finalized = true;

		for (const timer of this.timers) {
			clearInterval(timer);
			clearTimeout(timer);
		}
		if (this.backpressurePoller) {
			clearInterval(this.backpressurePoller);
		}
		if (this.drainTimer) {
			clearTimeout(this.drainTimer);
		}

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
			reason.startsWith("unpriceable_usage") ||
				reason === "billing_unavailable" ||
				reason === "upstream_protocol_error" ||
				reason === "unbillable_generation"
				? "error"
				: "closed",
			reason,
			{ bytesIn: this.bytesIn, bytesOut: this.bytesOut },
		).catch((error: unknown) => {
			logger.error(
				"Failed to finalize Gemini realtime session record",
				error as Error,
			);
		});

		this.onClosed(this);
	}

	public get openedAtMs(): number {
		return this.openedAt;
	}

	// --- Socket plumbing with backpressure ---

	private sendToClientRaw(text: string): void {
		if (this.client.readyState !== WebSocket.OPEN) {
			return;
		}
		this.client.send(text);
		this.applyBackpressure(this.client, this.upstream);
	}

	private forwardToUpstream(text: string): void {
		if (this.upstream.readyState !== WebSocket.OPEN) {
			this.sendToClientRaw(
				buildGeminiError(
					"upstream_unavailable",
					"The upstream realtime connection is no longer available.",
				),
			);
			return;
		}
		this.upstream.send(text);
		this.applyBackpressure(this.upstream, this.client);
	}

	/**
	 * When the destination socket's send buffer exceeds the high-water mark,
	 * pause reading from the source socket until it drains (or close the
	 * session if it never does).
	 */
	private applyBackpressure(destination: WebSocket, source: WebSocket): void {
		if (this.backpressurePoller) {
			return;
		}
		if (destination.bufferedAmount <= maxBufferedBytes()) {
			return;
		}
		source.pause();
		const startedAt = Date.now();
		this.backpressurePoller = setInterval(() => {
			if (this.finalized) {
				if (this.backpressurePoller) {
					clearInterval(this.backpressurePoller);
					this.backpressurePoller = null;
				}
				return;
			}
			if (destination.bufferedAmount <= maxBufferedBytes() / 4) {
				source.resume();
				if (this.backpressurePoller) {
					clearInterval(this.backpressurePoller);
					this.backpressurePoller = null;
				}
				return;
			}
			if (Date.now() - startedAt > backpressureTimeoutMs()) {
				if (this.backpressurePoller) {
					clearInterval(this.backpressurePoller);
					this.backpressurePoller = null;
				}
				this.settleAndShutdown(1011, "backpressure_timeout");
			}
		}, 100);
	}
}
