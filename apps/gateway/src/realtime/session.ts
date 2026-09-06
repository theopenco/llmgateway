import { Decimal } from "decimal.js";
import { WebSocket } from "ws";

import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import { getEffectiveDiscount } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	authorizeAccount,
	availableCredits,
	type AuthorizeAccountResult,
} from "./account-gate.js";
import {
	closeRealtimeSessionRecord,
	markRealtimeSessionUpstream,
	recordRealtimeResponse,
	recordRealtimeTranscription,
} from "./billing.js";
import { findRealtimeTranscriptionMapping } from "./catalog.js";
import {
	LEASE_HEARTBEAT_INTERVAL_MS,
	releaseRealtimeLease,
	renewRealtimeLease,
	type RealtimeLease,
} from "./leases.js";
import {
	applyRealtimeDiscount,
	buildRealtimePriceSnapshot,
	normalizeRealtimeUsage,
	priceRealtimeUsage,
} from "./pricing.js";
import {
	applyTranscriptionDiscount,
	buildTranscriptionPriceSnapshot,
	normalizeTranscriptionUsage,
	priceTranscriptionUsage,
} from "./transcription.js";

import type { RealtimeMappingMatch } from "./catalog.js";
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
 * event_id of the gateway-injected session.update that disables the provider's
 * own auto-response. Upstream errors carry the offending client event id, which
 * is what lets a failed injection release its pending echo suppression.
 */
const AUTO_RESPONSE_CONTROL_EVENT_ID = "event_lmg_disable_auto_response";

/**
 * event_id of the gateway-injected session.update that pins a transcription
 * session's ASR model upstream. Unlike the auto-response control above, a
 * rejection here is fatal: the provider would transcribe on its own default
 * model, which the session cannot bill.
 */
const TRANSCRIPTION_CONTROL_EVENT_ID = "event_lmg_pin_transcription_model";

/**
 * Stored prompt references are rejected: a prompt can carry its own tool
 * definitions, so honoring one would let hosted tools (MCP, connectors) past
 * the function-tools-only check and incur provider fees this gateway does not
 * meter.
 */
const PROMPT_NOT_SUPPORTED = [
	"prompt_not_supported",
	"Stored prompt references are not supported for realtime sessions on LLMGateway. Inline the instructions and tools instead.",
] as const;

let errorEventCounter = 0;

function buildErrorEvent(code: string, message: string): string {
	errorEventCounter += 1;
	return JSON.stringify({
		type: "error",
		event_id: `event_lmg_${Date.now()}_${errorEventCounter}`,
		error: {
			type: "invalid_request_error",
			code,
			message,
			param: null,
		},
	});
}

export interface RealtimeProxySessionOptions {
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
	 * When the session was opened with an ephemeral client secret that pinned a
	 * transcription model, only that ASR mapping may be enabled via
	 * session.update. Null allows any catalogue ASR mapping on the session's
	 * upstream provider.
	 */
	allowedTranscription: RealtimeMappingMatch | null;
	/**
	 * Instructions pinned by the client secret, applied on connect and locked
	 * against any client change. Null leaves instructions to the client.
	 */
	pinnedInstructions: string | null;
	/**
	 * Output voice pinned by the client secret, applied as the session default.
	 * Not locked, unlike instructions: the client may still change it.
	 */
	pinnedVoice: string | null;
	onClosed: (session: RealtimeProxySession) => void;
}

/**
 * One active realtime session: a client WebSocket bridged to an upstream
 * provider WebSocket with protocol mediation, per-response authorization
 * gates, exact usage billing, backpressure, and graceful draining.
 */
export class RealtimeProxySession {
	private readonly client: WebSocket;
	private readonly upstream: WebSocket;
	private readonly preflight: RealtimePreflightResult;
	private readonly gatewayToken: string;
	private readonly requestedModel: string;
	public readonly sessionRecordId: string;
	private readonly lease: RealtimeLease;
	private readonly source: string | null;
	private readonly userAgent: string | undefined;
	private readonly onClosed: (session: RealtimeProxySession) => void;

	private readonly openedAt = Date.now();
	private bytesIn = 0;
	private bytesOut = 0;
	private sessionSpend = new Decimal(0);

	// Whether the caller wants a response generated automatically at end of
	// speech. The gateway always disables the provider's own auto-response and
	// issues gated response.create events itself when this is true.
	private desiredAutoRespond = true;
	private turnDetectionEnabled = true;
	// Count of gateway-initiated control session.update events whose
	// session.updated echo should not be forwarded to the client.
	private suppressSessionUpdated = 0;
	private responseInFlight: string | null = null;
	private responseStartedAt: number | null = null;
	// A commit that arrived while a response was still in flight. The provider's
	// auto-response is disabled upstream, so the gateway must start the next
	// turn itself once the in-flight response's terminal event has been billed.
	private pendingAutoResponse = false;
	// ASR mapping pinned for the session by the first successful
	// session.update that enabled input transcription. Once pinned it is kept
	// for the rest of the session — including after transcription is disabled
	// again — because it is what prices the transcription events of items that
	// were committed while it was still on.
	private transcription: {
		match: RealtimeMappingMatch;
		requestedModel: string;
	} | null = null;
	// Whether input transcription is currently enabled, i.e. whether newly
	// committed audio items will produce a billable transcription event.
	private transcriptionEnabled = false;
	private readonly allowedTranscription: RealtimeMappingMatch | null;
	private readonly pinnedInstructions: string | null;
	private readonly pinnedVoice: string | null;
	// A transcription-only session (intent=transcription): its single model is
	// the ASR mapping, pinned from connect, and it never generates responses.
	private readonly transcriptionOnly: boolean;
	// User audio items whose billable transcription terminal event (completed
	// or failed) has not arrived yet: committed items, plus uncommitted audio
	// that has already produced transcript deltas. Draining must wait for these
	// so no billable transcription tail is dropped on disconnect.
	private readonly pendingTranscriptionItems = new Set<string>();
	// Uncommitted audio the provider is already transcribing live (streaming
	// ASR models emit deltas before any commit). The provider only reports the
	// billable duration in the completed event of a committed item, so this
	// audio has to be committed before the session can be torn down or the
	// buffer cleared, or the delivered transcript would go unbilled.
	private liveTranscriptionItem: string | null = null;
	// Close code/reason to finish a drain with once every billable tail event
	// has been captured.
	private drainClose: { code: number; reason: string } | null = null;
	// Serializes the async generation gates so two rapid response.create
	// events can't both pass the checks before either marks itself in-flight.
	private gateInProgress = false;
	private finalized = false;
	private draining = false;

	private clientAlive = true;
	private upstreamAlive = true;
	private readonly timers: NodeJS.Timeout[] = [];
	private backpressurePoller: NodeJS.Timeout | null = null;
	private drainTimer: NodeJS.Timeout | null = null;
	// Handling is asynchronous on the billing-critical paths (response.create
	// awaits the generation gates, response.done awaits its usage row) while
	// every other event forwards synchronously. Frames are therefore chained
	// rather than dispatched concurrently: otherwise a later frame overtakes
	// the one still awaiting and reaches the peer out of order.
	private clientQueue: Promise<void> = Promise.resolve();
	private upstreamQueue: Promise<void> = Promise.resolve();

	// Client and upstream frames are chained separately, so without a gate a
	// client that configures on socket open rather than on session.created —
	// which is the common shape — races the gateway's own control
	// session.update. Losing that race means generating under the provider's
	// defaults instead of the pinned instructions, or having the client's own
	// session.update overwritten by the control update that lands after it. The
	// whole client queue therefore starts behind this promise, which resolves
	// once the control update is forwarded and on teardown so nothing waits
	// forever.
	private resolveUpstreamConfigured!: () => void;
	private readonly upstreamConfigured = new Promise<void>((resolve) => {
		this.resolveUpstreamConfigured = resolve;
	});

	public constructor(options: RealtimeProxySessionOptions) {
		this.client = options.clientSocket;
		this.upstream = options.upstreamSocket;
		this.preflight = options.preflight;
		this.gatewayToken = options.gatewayToken;
		this.requestedModel = options.requestedModel;
		this.sessionRecordId = options.sessionRecordId;
		this.lease = options.lease;
		this.source = options.source;
		this.userAgent = options.userAgent;
		this.allowedTranscription = options.allowedTranscription;
		this.pinnedInstructions = options.pinnedInstructions;
		this.pinnedVoice = options.pinnedVoice;
		this.onClosed = options.onClosed;
		this.clientQueue = this.upstreamConfigured;
		this.transcriptionOnly = this.preflight.sessionType === "transcription";
		if (this.transcriptionOnly) {
			this.transcription = {
				match: this.preflight.match,
				requestedModel: this.requestedModel,
			};
			this.transcriptionEnabled = true;
			this.desiredAutoRespond = false;
			this.turnDetectionEnabled = false;
		}

		this.client.on("message", (data, isBinary) => {
			this.clientQueue = this.clientQueue
				.then(() => this.handleClientMessage(data, isBinary))
				.catch((error: unknown) => {
					logger.error(
						"Failed to handle realtime client event; closing session",
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
						"Failed to handle realtime upstream event; closing session",
						error as Error,
					);
					this.shutdown(1011, "internal_error");
				});
		});

		this.client.on("close", () => {
			void this.handleClientClose();
		});
		this.upstream.on("close", (code) => {
			this.handleUpstreamClose(code);
		});
		this.client.on("error", (error) => {
			logger.warn("Realtime client socket error", {
				sessionId: this.sessionRecordId,
				error: error.message,
			});
		});
		this.upstream.on("error", (error) => {
			logger.warn("Realtime upstream socket error", {
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

		// Hard session-duration limit: refuse to outlive the infrastructure's
		// draining ceiling.
		this.timers.push(
			setTimeout(() => {
				this.sendToClientRaw(
					buildErrorEvent(
						"session_duration_limit",
						"Maximum realtime session duration reached. Reconnect to continue.",
					),
				);
				this.drainOrShutdown(1000, "session_duration_limit");
			}, maxSessionMs()),
		);

		const ping = setInterval(() => {
			if (!this.upstreamAlive) {
				this.shutdown(1011, "ping_timeout");
				return;
			}
			if (!this.clientAlive && !this.draining) {
				// The client went silent while the upstream is healthy: drain so
				// billable work already in flight still gets its terminal event.
				this.drainOrShutdown(1011, "ping_timeout");
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
				buildErrorEvent(
					"invalid_frame",
					"Binary frames are not supported; send JSON text events.",
				),
			);
			return;
		}

		const text = data.toString();
		let message: Record<string, unknown>;
		try {
			const parsed = JSON.parse(text) as unknown;
			if (
				parsed === null ||
				typeof parsed !== "object" ||
				Array.isArray(parsed)
			) {
				throw new Error("not an object");
			}
			message = parsed as Record<string, unknown>;
		} catch {
			this.sendToClientRaw(
				buildErrorEvent("invalid_json", "Client event is not a JSON object."),
			);
			return;
		}

		const type = typeof message.type === "string" ? message.type : "";
		switch (type) {
			case "session.update":
				this.handleSessionUpdate(message);
				return;
			case "response.create":
				if (this.transcriptionOnly) {
					this.sendToClientRaw(
						buildErrorEvent(
							"response_not_supported",
							"Transcription sessions only transcribe input audio and cannot generate responses. Open a realtime session to use response.create.",
						),
					);
					return;
				}
				await this.handleResponseCreate(message);
				return;
			case "conversation.item.create":
				if (containsImageContent(message)) {
					this.sendToClientRaw(
						buildErrorEvent(
							"image_input_not_supported",
							"Image input is not yet supported for realtime sessions on LLMGateway.",
						),
					);
					return;
				}
				this.forwardToUpstream(JSON.stringify(message));
				return;
			case "input_audio_buffer.clear":
				// Clearing audio the provider has already transcribed live would
				// discard the only event that carries its billable duration. Commit
				// it first so the transcript the client already received is billed;
				// the buffer is then empty and the clear proceeds as requested.
				if (this.liveTranscriptionItem !== null) {
					this.forwardToUpstream(
						JSON.stringify({ type: "input_audio_buffer.commit" }),
					);
				}
				this.forwardToUpstream(text);
				return;
			default:
				this.forwardToUpstream(text);
		}
	}

	private handleSessionUpdate(message: Record<string, unknown>): void {
		const session =
			message.session && typeof message.session === "object"
				? (message.session as Record<string, unknown>)
				: {};
		const requestedSessionModel =
			typeof session.model === "string" ? session.model : undefined;

		// The model is pinned at connection time.
		if (
			requestedSessionModel !== undefined &&
			requestedSessionModel !== this.preflight.match.mapping.externalId &&
			requestedSessionModel !== this.preflight.match.modelId &&
			requestedSessionModel !== this.canonicalModelId(this.preflight.match)
		) {
			this.sendToClientRaw(
				buildErrorEvent(
					"model_locked",
					"The session model is locked at connection time and cannot be changed via session.update.",
				),
			);
			return;
		}

		// Rejected rather than ignored, so a caller that believes it configured
		// the prompt learns that it did not.
		if (
			this.pinnedInstructions !== null &&
			session.instructions !== undefined
		) {
			this.sendToClientRaw(
				buildErrorEvent(
					"instructions_locked",
					"The session instructions were pinned when this session's client secret was created and cannot be changed via session.update.",
				),
			);
			return;
		}

		// Input transcription has its own billing lifecycle: only catalogue ASR
		// mappings on this session's upstream provider are allowed, the model is
		// pinned for the session on first use, and the pinned mapping prices
		// every completed transcription event. Anything else is rejected rather
		// than silently unbilled.
		const audio =
			session.audio && typeof session.audio === "object"
				? (session.audio as Record<string, unknown>)
				: undefined;
		const audioInput =
			audio?.input && typeof audio.input === "object"
				? (audio.input as Record<string, unknown>)
				: undefined;
		const usesNestedTranscription =
			audioInput !== undefined && "transcription" in audioInput;
		const requestedTranscription = usesNestedTranscription
			? audioInput.transcription
			: session.input_audio_transcription;
		let rewrittenTranscriptionModel: string | null = null;
		// Transcription state is only committed once the whole update has been
		// accepted below: a later rejected field aborts the update without
		// forwarding it, so pinning or enabling transcription here would leave the
		// session tracking state the provider never applied.
		let nextTranscription: {
			match: RealtimeMappingMatch;
			requestedModel: string;
		} | null = null;
		let nextTranscriptionEnabled: boolean | null = null;
		if (requestedTranscription !== undefined) {
			if (requestedTranscription === null && this.transcriptionOnly) {
				this.sendToClientRaw(
					buildErrorEvent(
						"transcription_model_required",
						"A transcription session cannot disable input audio transcription.",
					),
				);
				return;
			}
			if (requestedTranscription === null) {
				// Disabling transcription is always allowed. The pinned mapping is
				// deliberately kept: items committed while transcription was on still
				// produce transcription events, and they can only be priced (rather
				// than killing the session as unbillable) while the mapping survives.
				nextTranscriptionEnabled = false;
			} else if (typeof requestedTranscription === "object") {
				const config = requestedTranscription as Record<string, unknown>;
				const requestedModel =
					typeof config.model === "string" ? config.model : undefined;
				if (!requestedModel) {
					// The provider default (e.g. whisper-1) is duration-billed and
					// cannot be priced per token, so an explicit supported model is
					// required.
					this.sendToClientRaw(
						buildErrorEvent(
							"transcription_model_required",
							"Input audio transcription requires an explicit, supported transcription model.",
						),
					);
					return;
				}
				const match = findRealtimeTranscriptionMapping(
					requestedModel,
					this.preflight.match.mapping.providerId,
				);
				if (!match) {
					this.sendToClientRaw(
						buildErrorEvent(
							"transcription_model_not_supported",
							`Transcription model not supported for realtime sessions: ${requestedModel}`,
						),
					);
					return;
				}
				// A pinned model is checked before IAM so the caller learns the model
				// is locked rather than that it is merely disallowed.
				if (
					this.allowedTranscription &&
					(match.mapping.providerId !==
						this.allowedTranscription.mapping.providerId ||
						match.mapping.externalId !==
							this.allowedTranscription.mapping.externalId)
				) {
					this.sendToClientRaw(
						buildErrorEvent(
							"transcription_model_locked",
							this.transcriptionOnly
								? "The transcription model is pinned for this session and cannot be changed."
								: "The transcription model was pinned when this session's client secret was created and cannot be changed.",
						),
					);
					return;
				}
				if (
					this.transcription &&
					(match.mapping.providerId !==
						this.transcription.match.mapping.providerId ||
						match.mapping.externalId !==
							this.transcription.match.mapping.externalId)
				) {
					this.sendToClientRaw(
						buildErrorEvent(
							"transcription_model_locked",
							"The transcription model is pinned for this session and cannot be changed.",
						),
					);
					return;
				}
				if (
					!this.preflight.allowedTranscriptionModelIds.includes(match.modelId)
				) {
					// Transcription bills a second model, so it must clear the same
					// per-key IAM rules as the realtime model (resolved at connect
					// time).
					this.sendToClientRaw(
						buildErrorEvent(
							"transcription_model_not_allowed",
							`This API key is not allowed to use the transcription model ${match.modelId}.`,
						),
					);
					return;
				}
				nextTranscription = { match, requestedModel };
				nextTranscriptionEnabled = true;
				rewrittenTranscriptionModel = match.mapping.externalId;
			} else {
				this.sendToClientRaw(
					buildErrorEvent(
						"invalid_transcription_config",
						"input_audio_transcription must be an object or null.",
					),
				);
				return;
			}
		}

		// Hosted tools (MCP, web search, etc.) carry separate fees that are not
		// metered here; only plain function tools are allowed.
		if (containsUnsupportedTools(session.tools)) {
			this.sendToClientRaw(
				buildErrorEvent(
					"tool_type_not_supported",
					"Only function tools are supported for realtime sessions on LLMGateway. Hosted tools (MCP, web search, etc.) are not yet available.",
				),
			);
			return;
		}
		// A stored prompt reference can carry its own tool definitions, which would
		// slip hosted tools past the check above.
		if (session.prompt !== undefined && session.prompt !== null) {
			this.sendToClientRaw(buildErrorEvent(...PROMPT_NOT_SUPPORTED));
			return;
		}

		// Every validation passed, so the update will be forwarded: commit the
		// transcription state it asked for.
		if (nextTranscription) {
			this.transcription = nextTranscription;
		}
		if (nextTranscriptionEnabled !== null) {
			this.transcriptionEnabled = nextTranscriptionEnabled;
		}

		// Remember the caller's desired auto-response behavior, then force it off
		// upstream so every generation passes through the gateway's gates.
		const turnDetection =
			audioInput && "turn_detection" in audioInput
				? audioInput.turn_detection
				: "turn_detection" in session
					? session.turn_detection
					: undefined;
		let forwarded = message;
		const cloneForwarded = (): Record<string, unknown> => {
			if (forwarded === message) {
				forwarded = structuredClone(message);
			}
			return forwarded;
		};
		if (requestedSessionModel !== undefined) {
			const fwdSession = cloneForwarded().session as Record<string, unknown>;
			fwdSession.model = this.preflight.match.mapping.externalId;
		}
		// A transcription session never generates, so its VAD config is forwarded
		// untouched: there is no auto-response to take over.
		if (turnDetection !== undefined && !this.transcriptionOnly) {
			if (turnDetection === null) {
				this.turnDetectionEnabled = false;
			} else if (typeof turnDetection === "object") {
				this.turnDetectionEnabled = true;
				const td = turnDetection as Record<string, unknown>;
				this.desiredAutoRespond = td.create_response !== false;
				const rewritten = { ...td, create_response: false };
				const fwdSession = cloneForwarded().session as Record<string, unknown>;
				const fwdAudio = fwdSession.audio as
					Record<string, unknown> | undefined;
				const fwdAudioInput = fwdAudio?.input as
					Record<string, unknown> | undefined;
				if (fwdAudioInput && "turn_detection" in fwdAudioInput) {
					fwdAudioInput.turn_detection = rewritten;
				} else {
					fwdSession.turn_detection = rewritten;
				}
			}
		}
		if (rewrittenTranscriptionModel !== null) {
			// Forward the provider's own model id for the pinned ASR mapping.
			const fwdSession = cloneForwarded().session as Record<string, unknown>;
			if (usesNestedTranscription) {
				const fwdAudio = fwdSession.audio as Record<string, unknown>;
				const fwdAudioInput = fwdAudio.input as Record<string, unknown>;
				const fwdTranscription = fwdAudioInput.transcription as Record<
					string,
					unknown
				>;
				fwdTranscription.model = rewrittenTranscriptionModel;
			} else {
				const fwdTranscription = fwdSession.input_audio_transcription as Record<
					string,
					unknown
				>;
				fwdTranscription.model = rewrittenTranscriptionModel;
			}
		}

		this.forwardToUpstream(JSON.stringify(forwarded));
	}

	private async handleResponseCreate(
		message: Record<string, unknown>,
	): Promise<void> {
		// response.create may carry inline input items and per-response tools;
		// apply the same deferred-capability guards as session-level config.
		const response =
			message.response && typeof message.response === "object"
				? (message.response as Record<string, unknown>)
				: undefined;
		if (response) {
			const input = response.input;
			if (
				Array.isArray(input) &&
				input.some(
					(item) =>
						item &&
						typeof item === "object" &&
						itemContainsImageContent(item as Record<string, unknown>),
				)
			) {
				this.sendToClientRaw(
					buildErrorEvent(
						"image_input_not_supported",
						"Image input is not yet supported for realtime sessions on LLMGateway.",
					),
				);
				return;
			}
			if (containsUnsupportedTools(response.tools)) {
				this.sendToClientRaw(
					buildErrorEvent(
						"tool_type_not_supported",
						"Only function tools are supported for realtime sessions on LLMGateway. Hosted tools (MCP, web search, etc.) are not yet available.",
					),
				);
				return;
			}
			if (response.prompt !== undefined && response.prompt !== null) {
				this.sendToClientRaw(buildErrorEvent(...PROMPT_NOT_SUPPORTED));
				return;
			}
			// Per-response instructions override the session's, so the lock has to
			// be enforced here as well as on session.update.
			if (
				this.pinnedInstructions !== null &&
				response.instructions !== undefined
			) {
				this.sendToClientRaw(
					buildErrorEvent(
						"instructions_locked",
						"The session instructions were pinned when this session's client secret was created and cannot be overridden per response.",
					),
				);
				return;
			}
		}

		const allowed = await this.runGenerationGates();
		if (!allowed) {
			return;
		}
		if (this.clientGone()) {
			return;
		}
		this.responseInFlight = "pending";
		this.responseStartedAt = Date.now();
		this.forwardToUpstream(JSON.stringify(message));
	}

	private async maybeAutoRespond(): Promise<void> {
		if (this.transcriptionOnly || this.clientGone()) {
			// Server VAD can still commit residual audio while the session drains;
			// starting a generation now bills a response nobody receives (and the
			// drain timer may kill it mid-flight, leaving the provider's cost
			// unbilled entirely).
			return;
		}
		if (!this.turnDetectionEnabled || !this.desiredAutoRespond) {
			return;
		}
		if (this.responseInFlight) {
			return;
		}
		const allowed = await this.runGenerationGates();
		if (!allowed) {
			return;
		}
		if (this.clientGone()) {
			return;
		}
		this.responseInFlight = "pending";
		this.responseStartedAt = Date.now();
		this.forwardToUpstream(JSON.stringify({ type: "response.create" }));
	}

	/**
	 * True once the client has gone away: the session is draining its billable
	 * tail or has already been finalized. No new generation may start.
	 */
	private clientGone(): boolean {
		return this.draining || this.finalized;
	}

	/**
	 * Authorization point every model generation must pass: fresh key/org
	 * state, per-key usage limits, credits including this session's
	 * not-yet-settled spend, the per-session spend cap, the single-in-flight
	 * rule, and the org's provider/model rate-limit slot.
	 */
	private async runGenerationGates(): Promise<boolean> {
		if (this.responseInFlight || this.gateInProgress) {
			this.sendToClientRaw(
				buildErrorEvent(
					"response_in_flight",
					"Another response is already in progress for this session.",
				),
			);
			return false;
		}
		this.gateInProgress = true;
		try {
			return await this.runGenerationGatesInner();
		} finally {
			this.gateInProgress = false;
		}
	}

	private async authorizeAccount(
		match: RealtimeMappingMatch,
	): Promise<AuthorizeAccountResult> {
		return await authorizeAccount({
			preflight: this.preflight,
			gatewayToken: this.gatewayToken,
			requestedModel: this.requestedModel,
			match,
		});
	}

	private async runGenerationGatesInner(): Promise<boolean> {
		if (this.sessionSpend.greaterThanOrEqualTo(maxSessionSpendUsd())) {
			this.sendToClientRaw(
				buildErrorEvent(
					"session_spend_limit",
					`This session has reached its spend limit ($${maxSessionSpendUsd()}). Reconnect to start a new session.`,
				),
			);
			return false;
		}

		const authorization = await this.authorizeAccount(this.preflight.match);
		if (!authorization.ok) {
			this.sendToClientRaw(
				buildErrorEvent(authorization.code, authorization.message),
			);
			if (authorization.severity === "close") {
				this.shutdown(1008, authorization.code);
			}
			return false;
		}

		if (this.preflight.usedMode === "credits") {
			const available = await this.availableCredits(authorization.organization);
			if (available === null) {
				this.sendToClientRaw(
					buildErrorEvent(
						"gate_unavailable",
						"Unable to verify account state; generation is temporarily unavailable.",
					),
				);
				return false;
			}
			if (available.lessThanOrEqualTo(0)) {
				this.sendToClientRaw(
					buildErrorEvent(
						"insufficient_credits",
						"Organization has insufficient credits for further responses.",
					),
				);
				return false;
			}
		}

		const rateLimit = await checkProviderRateLimit(
			this.preflight.project.organizationId,
			this.preflight.match.mapping.providerId,
			this.preflight.match.modelId,
		);
		if (!rateLimit.allowed) {
			this.sendToClientRaw(
				buildErrorEvent(
					"rate_limit_exceeded",
					`Provider rate limit exceeded${rateLimit.retryAfter ? `; retry after ${rateLimit.retryAfter}s` : ""}.`,
				),
			);
			return false;
		}

		return true;
	}

	private async availableCredits(
		organization: Parameters<typeof availableCredits>[1],
	): Promise<Decimal | null> {
		return await availableCredits(
			this.preflight.project.organizationId,
			organization,
		);
	}

	/**
	 * Transcription is billed off the provider's own commit-driven events, so it
	 * cannot be authorized up front the way response.create is. Re-run the same
	 * authorization gates right after each transcription is billed instead — the
	 * session spend cap, account state for the pinned ASR model, and the
	 * organization's credits. A session that no longer clears them is closed, so
	 * a revoked key or exhausted account can overrun by at most one turn rather
	 * than streaming mic audio indefinitely on a transcription-only session that
	 * never sends response.create.
	 *
	 * Every failure closes the session: unlike response.create there is no
	 * single unit of work to refuse, so "deny" and "close" are the same action
	 * here. Only an unreadable account state is tolerated, matching the
	 * generation gate, which lets the caller retry rather than dropping the
	 * session on a transient database error.
	 */
	private async enforceLimitsAfterTranscription(): Promise<void> {
		if (this.finalized) {
			return;
		}
		if (this.sessionSpend.greaterThanOrEqualTo(maxSessionSpendUsd())) {
			this.sendToClientRaw(
				buildErrorEvent(
					"session_spend_limit",
					`This session has reached its spend limit ($${maxSessionSpendUsd()}). Reconnect to start a new session.`,
				),
			);
			this.drainOrShutdown(1008, "session_spend_limit");
			return;
		}
		const transcriptionMatch =
			this.transcription?.match ?? this.preflight.match;
		const authorization = await this.authorizeAccount(transcriptionMatch);
		if (!authorization.ok) {
			if (authorization.severity === "transient") {
				return;
			}
			this.sendToClientRaw(
				buildErrorEvent(authorization.code, authorization.message),
			);
			this.drainOrShutdown(1008, authorization.code);
			return;
		}
		// A transcription session never passes the generation gates, so each
		// billed transcription is the unit that consumes the provider/model
		// rate-limit slot instead. (Speech sessions consume it per generation;
		// charging their input transcription too would double-count.)
		if (this.transcriptionOnly) {
			const rateLimit = await checkProviderRateLimit(
				this.preflight.project.organizationId,
				transcriptionMatch.mapping.providerId,
				transcriptionMatch.modelId,
			);
			if (!rateLimit.allowed) {
				this.sendToClientRaw(
					buildErrorEvent(
						"rate_limit_exceeded",
						`Provider rate limit exceeded${rateLimit.retryAfter ? `; retry after ${rateLimit.retryAfter}s` : ""}.`,
					),
				);
				this.drainOrShutdown(1008, "rate_limit_exceeded");
				return;
			}
		}
		if (this.preflight.usedMode !== "credits") {
			return;
		}
		const available = await this.availableCredits(authorization.organization);
		if (available === null || available.greaterThan(0)) {
			return;
		}
		this.sendToClientRaw(
			buildErrorEvent(
				"insufficient_credits",
				"Organization has insufficient credits to continue this session.",
			),
		);
		this.drainOrShutdown(1008, "insufficient_credits");
	}

	private canonicalModelId(match: RealtimeMappingMatch): string {
		return formatUsedModelForDisplay(
			match.mapping.providerId,
			match.modelId,
			undefined,
			match.mapping.region,
		);
	}

	/**
	 * Strip pinned instructions from a session object on its way to the client.
	 * The provider echoes the full session state on every session.updated, which
	 * would otherwise hand the pinned prompt back to the client.
	 */
	private redactPinnedInstructions(session: Record<string, unknown>): void {
		if (this.pinnedInstructions !== null && "instructions" in session) {
			delete session.instructions;
		}
	}

	private normalizeSessionModelIds(session: Record<string, unknown>): void {
		// A transcription session object carries no session model; its only
		// model is the transcription one, canonicalized below.
		if (!this.transcriptionOnly) {
			session.model = this.canonicalModelId(this.preflight.match);
		}
		const audio =
			session.audio && typeof session.audio === "object"
				? (session.audio as Record<string, unknown>)
				: undefined;
		const input =
			audio?.input && typeof audio.input === "object"
				? (audio.input as Record<string, unknown>)
				: undefined;
		const nestedTranscription =
			input?.transcription && typeof input.transcription === "object"
				? (input.transcription as Record<string, unknown>)
				: undefined;
		const legacyTranscription =
			session.input_audio_transcription &&
			typeof session.input_audio_transcription === "object"
				? (session.input_audio_transcription as Record<string, unknown>)
				: undefined;
		const transcriptionMatch =
			this.transcription?.match ?? this.allowedTranscription;
		if (transcriptionMatch) {
			if (nestedTranscription) {
				nestedTranscription.model = this.canonicalModelId(transcriptionMatch);
			}
			if (legacyTranscription) {
				legacyTranscription.model = this.canonicalModelId(transcriptionMatch);
			}
		}
	}

	// --- Upstream → client ---

	private async handleUpstreamMessage(data: RawData): Promise<void> {
		const text = data.toString();
		this.bytesOut += text.length;

		let event: Record<string, unknown>;
		try {
			event = JSON.parse(text) as Record<string, unknown>;
		} catch {
			// The upstream protocol is JSON-only; an unparseable frame means we
			// can no longer trust the billing-critical event stream.
			logger.error("Unparseable upstream realtime event; closing session", {
				sessionId: this.sessionRecordId,
			});
			this.shutdown(1011, "upstream_protocol_error");
			return;
		}

		const type = typeof event.type === "string" ? event.type : "";
		switch (type) {
			case "session.created": {
				const session =
					event.session && typeof event.session === "object"
						? (event.session as Record<string, unknown>)
						: {};
				if (typeof session.id === "string") {
					void markRealtimeSessionUpstream(
						this.sessionRecordId,
						session.id,
					).catch((error: unknown) => {
						logger.error(
							"Failed to record upstream realtime session id",
							error as Error,
						);
					});
				}
				this.normalizeSessionModelIds(session);
				this.redactPinnedInstructions(session);
				this.sendToClientRaw(JSON.stringify(event));
				if (this.transcriptionOnly) {
					// Pin the billed ASR model upstream before any client event, so
					// audio committed by a client that never configures the model is
					// still transcribed on the mapping this session bills.
					this.suppressSessionUpdated += 1;
					this.forwardToUpstream(
						JSON.stringify({
							type: "session.update",
							event_id: TRANSCRIPTION_CONTROL_EVENT_ID,
							session: {
								type: "transcription",
								audio: {
									input: {
										transcription: {
											model: this.preflight.match.mapping.externalId,
										},
									},
								},
							},
						}),
					);
					this.resolveUpstreamConfigured();
					return;
				}
				// Disable the provider's automatic VAD response so every generation
				// passes the gateway's authorization gates, and apply any pinned
				// instructions and voice. The echoed session.updated for this
				// control message is suppressed below.
				this.suppressSessionUpdated += 1;
				this.forwardToUpstream(
					JSON.stringify({
						type: "session.update",
						event_id: AUTO_RESPONSE_CONTROL_EVENT_ID,
						session: {
							type: "realtime",
							...(this.pinnedInstructions !== null
								? { instructions: this.pinnedInstructions }
								: {}),
							audio: {
								input: {
									turn_detection: {
										type: "server_vad",
										create_response: false,
									},
								},
								...(this.pinnedVoice !== null
									? { output: { voice: this.pinnedVoice } }
									: {}),
							},
						},
					}),
				);
				this.resolveUpstreamConfigured();
				return;
			}
			case "session.updated": {
				if (this.suppressSessionUpdated > 0) {
					this.suppressSessionUpdated -= 1;
					return;
				}
				const session =
					event.session && typeof event.session === "object"
						? (event.session as Record<string, unknown>)
						: {};
				this.normalizeSessionModelIds(session);
				this.redactPinnedInstructions(session);
				this.sendToClientRaw(JSON.stringify(event));
				return;
			}
			case "response.created": {
				const response =
					event.response && typeof event.response === "object"
						? (event.response as Record<string, unknown>)
						: {};
				this.responseInFlight =
					typeof response.id === "string" ? response.id : "pending";
				this.responseStartedAt = this.responseStartedAt ?? Date.now();
				response.model = this.canonicalModelId(this.preflight.match);
				this.sendToClientRaw(JSON.stringify(event));
				return;
			}
			case "response.done": {
				const response =
					event.response && typeof event.response === "object"
						? (event.response as Record<string, unknown>)
						: undefined;
				if (response) {
					response.model = this.canonicalModelId(this.preflight.match);
				}
				await this.handleResponseDone(event, JSON.stringify(event));
				return;
			}
			case "conversation.item.input_audio_transcription.delta": {
				// A delta for an item that was never committed means the provider is
				// transcribing the live buffer: from here on that audio is billable
				// work that must be committed before teardown.
				const itemId =
					typeof event.item_id === "string" ? event.item_id : undefined;
				if (itemId && !this.pendingTranscriptionItems.has(itemId)) {
					this.pendingTranscriptionItems.add(itemId);
					this.liveTranscriptionItem = itemId;
				}
				this.sendToClientRaw(text);
				return;
			}
			case "input_audio_buffer.cleared": {
				if (this.liveTranscriptionItem !== null) {
					// The gateway commits live audio ahead of every clear, so the
					// provider dropped it on its own: nothing carries its duration.
					logger.error("Realtime live transcription audio cleared unbilled", {
						sessionId: this.sessionRecordId,
						itemId: this.liveTranscriptionItem,
					});
					this.pendingTranscriptionItems.delete(this.liveTranscriptionItem);
					this.liveTranscriptionItem = null;
					this.maybeFinishDrain();
				}
				this.sendToClientRaw(text);
				return;
			}
			case "input_audio_buffer.committed": {
				const itemId =
					typeof event.item_id === "string" ? event.item_id : undefined;
				if (itemId === this.liveTranscriptionItem) {
					this.liveTranscriptionItem = null;
				}
				if (this.transcriptionEnabled && itemId) {
					this.pendingTranscriptionItems.add(itemId);
				}
				this.sendToClientRaw(text);
				if (this.responseInFlight) {
					// A commit during an in-flight response (barge-in) must still get
					// its automatic turn: remember it and start it after the cancelled
					// response's terminal event has been billed.
					if (this.turnDetectionEnabled && this.desiredAutoRespond) {
						this.pendingAutoResponse = true;
					}
				} else {
					void this.maybeAutoRespond();
				}
				return;
			}
			case "conversation.item.input_audio_transcription.completed":
				await this.handleTranscriptionCompleted(event, text);
				return;
			case "conversation.item.input_audio_transcription.failed": {
				const itemId =
					typeof event.item_id === "string" ? event.item_id : undefined;
				if (itemId) {
					this.pendingTranscriptionItems.delete(itemId);
				}
				this.sendToClientRaw(text);
				this.maybeFinishDrain();
				return;
			}
			case "error": {
				const errorPayload =
					event.error && typeof event.error === "object"
						? (event.error as Record<string, unknown>)
						: undefined;
				if (errorPayload?.event_id === TRANSCRIPTION_CONTROL_EVENT_ID) {
					// Without the pin the provider transcribes on its own default
					// model, whose usage this session cannot price.
					logger.error(
						"Realtime transcription model pin rejected upstream; closing session",
						{ sessionId: this.sessionRecordId, error: errorPayload },
					);
					this.sendToClientRaw(text);
					this.shutdown(1011, "transcription_pin_rejected");
					return;
				}
				if (
					this.suppressSessionUpdated > 0 &&
					errorPayload?.event_id === AUTO_RESPONSE_CONTROL_EVENT_ID
				) {
					// The gateway's own control update was rejected, so the
					// session.updated echo it was waiting on will never arrive.
					// Releasing the suppression here keeps it from swallowing a later
					// legitimate ack for the client's own session.update.
					this.suppressSessionUpdated -= 1;
				}
				// A response.create rejected by the provider before any
				// response.created never produces a terminal response.done, so a
				// pending in-flight marker must be released here or the session
				// would refuse all further generations.
				if (this.responseInFlight === "pending") {
					this.responseInFlight = null;
					this.responseStartedAt = null;
				}
				this.sendToClientRaw(text);
				return;
			}
			default:
				this.sendToClientRaw(text);
		}
	}

	private async handleResponseDone(
		event: Record<string, unknown>,
		rawText: string,
	): Promise<void> {
		const response =
			event.response && typeof event.response === "object"
				? (event.response as Record<string, unknown>)
				: undefined;
		const responseId =
			response && typeof response.id === "string" ? response.id : undefined;
		// Recorded for auditability only: realtime deliberately does NOT honour
		// BILL_CANCELLED_REQUESTS. A cancelled response still reports the audio
		// it already generated, and the upstream provider bills us for it, so
		// every terminal response is charged regardless of status. The HTTP path
		// bills cancelled requests by default too (BILL_CANCELLED_REQUESTS), but
		// can be opted out of; realtime cannot.
		const responseStatus =
			response && typeof response.status === "string"
				? response.status
				: "completed";

		if (!response || !responseId) {
			logger.error("Realtime response.done without response id", {
				sessionId: this.sessionRecordId,
			});
			this.shutdown(1011, "unbillable_response");
			return;
		}

		const normalized = normalizeRealtimeUsage(response.usage);
		if (!normalized.ok) {
			logger.error(`Unpriceable realtime usage: ${normalized.reason}`, {
				sessionId: this.sessionRecordId,
				responseId,
				usage: response.usage,
			});
			this.shutdown(1011, `unpriceable_usage:${normalized.reason}`);
			return;
		}

		const snapshot = buildRealtimePriceSnapshot(this.preflight.match.mapping);
		const priced = priceRealtimeUsage(normalized.usage, snapshot);
		if (!priced.ok) {
			logger.error(`Unpriceable realtime usage: ${priced.reason}`, {
				sessionId: this.sessionRecordId,
				responseId,
				usage: normalized.usage,
			});
			this.shutdown(1011, `unpriceable_usage:${priced.reason}`);
			return;
		}

		// Apply the organization/provider/model discount exactly like the HTTP
		// billing path does. Note that getEffectiveDiscount swallows its own
		// database errors and returns a 0% discount, so a discount-lookup
		// outage bills at full price rather than reaching the catch below. That
		// matches the HTTP path; the catch only covers unexpected throws.
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
				"Failed to resolve realtime discount; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return;
		}
		const discountedCosts = applyRealtimeDiscount(priced.costs, discount);

		const durationMs = this.responseStartedAt
			? Date.now() - this.responseStartedAt
			: 0;
		try {
			// Persist the billable event BEFORE forwarding its terminal event. On
			// database failure the session fails closed instead of delivering
			// unbilled work.
			const { inserted } = await recordRealtimeResponse({
				preflight: this.preflight,
				sessionId: this.sessionRecordId,
				requestedModel: this.requestedModel,
				responseId,
				responseStatus,
				durationMs,
				responseSizeBytes: rawText.length,
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
				"Failed to persist realtime billing event; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return;
		}

		this.responseInFlight = null;
		this.responseStartedAt = null;
		this.sendToClientRaw(rawText);

		if (this.draining) {
			// The billable response tail has been captured; release the upstream
			// once any outstanding transcription events have also been billed.
			this.maybeFinishDrain();
			return;
		}

		if (this.pendingAutoResponse) {
			// A turn was committed while this response was still in flight; now
			// that the terminal event is billed, run the normal generation gates
			// and start the pending response.
			this.pendingAutoResponse = false;
			void this.maybeAutoRespond();
		}
	}

	/**
	 * One completed input-audio transcription: strictly normalize and price its
	 * usage against the pinned ASR mapping, persist the billing row, then
	 * forward the transcript. Fails closed on any unpriceable or unpersistable
	 * event so no transcript is delivered unbilled.
	 */
	private async handleTranscriptionCompleted(
		event: Record<string, unknown>,
		rawText: string,
	): Promise<void> {
		const itemId =
			typeof event.item_id === "string" ? event.item_id : undefined;
		const contentIndex =
			typeof event.content_index === "number" &&
			Number.isInteger(event.content_index) &&
			event.content_index >= 0
				? event.content_index
				: 0;

		if (!this.transcription || !itemId) {
			logger.error(
				"Realtime transcription completed without a pinned ASR mapping or item id",
				{ sessionId: this.sessionRecordId, itemId },
			);
			this.shutdown(1011, "unbillable_transcription");
			return;
		}

		const normalized = normalizeTranscriptionUsage(event.usage);
		if (!normalized.ok) {
			logger.error(`Unpriceable transcription usage: ${normalized.reason}`, {
				sessionId: this.sessionRecordId,
				itemId,
				usage: event.usage,
			});
			this.shutdown(1011, `unpriceable_transcription:${normalized.reason}`);
			return;
		}

		const snapshot = buildTranscriptionPriceSnapshot(
			this.transcription.match.mapping,
		);
		const priced = priceTranscriptionUsage(normalized.usage, snapshot);
		if (!priced.ok) {
			logger.error(`Unpriceable transcription usage: ${priced.reason}`, {
				sessionId: this.sessionRecordId,
				itemId,
				usage: normalized.usage,
			});
			this.shutdown(1011, `unpriceable_transcription:${priced.reason}`);
			return;
		}

		// The ASR mapping carries its own discount scope, independent of the
		// realtime model's. As above, getEffectiveDiscount returns a 0%
		// discount on database errors, so this catch only covers unexpected
		// throws rather than a discount-lookup outage.
		let discount: Decimal;
		try {
			const effectiveDiscount = await getEffectiveDiscount(
				this.preflight.project.organizationId,
				this.transcription.match.mapping.providerId,
				this.transcription.match.modelId,
			);
			discount = new Decimal(effectiveDiscount.discount);
		} catch (error) {
			logger.error(
				"Failed to resolve realtime transcription discount; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return;
		}
		const discountedCosts = applyTranscriptionDiscount(priced.costs, discount);

		try {
			// Persist the billable event BEFORE forwarding the transcript. On
			// database failure the session fails closed instead of delivering
			// unbilled work.
			const { inserted } = await recordRealtimeTranscription({
				preflight: this.preflight,
				sessionId: this.sessionRecordId,
				transcription: this.transcription.match,
				requestedModel: this.transcription.requestedModel,
				itemId,
				contentIndex,
				responseSizeBytes: rawText.length,
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
				"Failed to persist realtime transcription billing event; closing session",
				error as Error,
			);
			this.shutdown(1011, "billing_unavailable");
			return;
		}

		this.pendingTranscriptionItems.delete(itemId);
		this.sendToClientRaw(rawText);
		this.maybeFinishDrain();
		await this.enforceLimitsAfterTranscription();
	}

	/**
	 * Finish a client-initiated drain once every billable tail event — the
	 * in-flight response and all outstanding transcriptions — has been
	 * captured.
	 */
	private maybeFinishDrain(): void {
		if (
			this.draining &&
			!this.responseInFlight &&
			this.pendingTranscriptionItems.size === 0
		) {
			this.shutdown(
				this.drainClose?.code ?? 1000,
				this.drainClose?.reason ?? "client_disconnected",
			);
		}
	}

	/**
	 * Close the session, first draining any billable work still outstanding:
	 * an in-flight response is cancelled and live-transcribed audio committed,
	 * then the upstream stays open (bounded by the drain timeout) to capture
	 * the terminal events that carry their usage. The client socket is closed
	 * immediately so nothing new can start during the drain.
	 */
	private drainOrShutdown(code: number, reason: string): void {
		if (this.finalized || this.draining) {
			return;
		}
		if (
			(this.responseInFlight ||
				this.pendingTranscriptionItems.size > 0 ||
				this.liveTranscriptionItem !== null) &&
			this.upstream.readyState === WebSocket.OPEN
		) {
			this.draining = true;
			this.drainClose = { code, reason };
			if (this.responseInFlight) {
				this.forwardToUpstream(JSON.stringify({ type: "response.cancel" }));
			}
			if (this.liveTranscriptionItem !== null) {
				this.forwardToUpstream(
					JSON.stringify({ type: "input_audio_buffer.commit" }),
				);
			}
			try {
				if (this.client.readyState === WebSocket.OPEN) {
					this.client.close(code, reason.slice(0, 120));
				}
			} catch {
				this.client.terminate();
			}
			this.drainTimer = setTimeout(() => {
				this.shutdown(code, `${reason}_drain_timeout`);
			}, drainTimeoutMs());
			return;
		}
		this.shutdown(code, reason);
	}

	// --- Lifecycle ---

	private async handleClientClose(): Promise<void> {
		this.drainOrShutdown(1000, "client_disconnected");
	}

	private handleUpstreamClose(code: number): void {
		if (this.finalized) {
			return;
		}
		this.shutdown(
			code === 1000 ? 1000 : 1011,
			code === 1000 ? "upstream_closed" : `upstream_closed_${code}`,
		);
	}

	/**
	 * Force-close from outside (server drain). Outstanding billable work is
	 * drained first, within the drain timeout, which the server's shutdown
	 * grace period covers.
	 */
	public close(code: number, reason: string): void {
		this.drainOrShutdown(code, reason);
	}

	/**
	 * Close both sockets and finalize the session record. Idempotent.
	 */
	public shutdown(code: number, reason: string): void {
		if (this.finalized) {
			return;
		}
		this.finalized = true;
		// Release anything still waiting for the control update; the checks after
		// it drop the frame once the session is finalized.
		this.resolveUpstreamConfigured();

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
				reason.startsWith("unpriceable_transcription") ||
				reason === "billing_unavailable" ||
				reason === "upstream_protocol_error" ||
				reason === "unbillable_response" ||
				reason === "unbillable_transcription" ||
				reason === "transcription_pin_rejected"
				? "error"
				: "closed",
			reason,
			{ bytesIn: this.bytesIn, bytesOut: this.bytesOut },
		).catch((error: unknown) => {
			logger.error(
				"Failed to finalize realtime session record",
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
				buildErrorEvent(
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
				if (destination === this.client) {
					// The client stopped reading while the upstream is healthy: let
					// upstream events flow again so the drain can capture the
					// terminal events of billable work in flight.
					source.resume();
					this.drainOrShutdown(1011, "backpressure_timeout");
					return;
				}
				this.shutdown(1011, "backpressure_timeout");
			}
		}, 100);
	}
}

function itemContainsImageContent(item: Record<string, unknown>): boolean {
	const content = item.content;
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some(
		(part) =>
			part &&
			typeof part === "object" &&
			(part as Record<string, unknown>).type === "input_image",
	);
}

function containsImageContent(message: Record<string, unknown>): boolean {
	const item =
		message.item && typeof message.item === "object"
			? (message.item as Record<string, unknown>)
			: undefined;
	return item ? itemContainsImageContent(item) : false;
}

/**
 * Only plain function tools are allowed; hosted tool types (mcp, web search,
 * image generation, etc.) carry separate provider fees that are not metered.
 */
function containsUnsupportedTools(tools: unknown): boolean {
	if (!Array.isArray(tools)) {
		return false;
	}
	return tools.some(
		(tool) =>
			!tool ||
			typeof tool !== "object" ||
			(tool as Record<string, unknown>).type !== "function",
	);
}
