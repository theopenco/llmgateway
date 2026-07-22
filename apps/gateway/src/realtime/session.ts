import { Decimal } from "decimal.js";
import { WebSocket } from "ws";

import {
	assertApiKeyWithinUsageLimits,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { checkProviderRateLimit } from "@/lib/provider-rate-limit.js";

import { getEffectiveDiscount } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	closeRealtimeSessionRecord,
	getUnsettledRealtimeSessionSpend,
	markRealtimeSessionUpstream,
	recordRealtimeResponse,
} from "./billing.js";
import {
	LEASE_HEARTBEAT_INTERVAL_MS,
	releaseRealtimeLease,
	renewRealtimeLease,
	type RealtimeLease,
} from "./leases.js";
import { getAvailableCredits } from "./preflight.js";
import {
	applyRealtimeDiscount,
	buildRealtimePriceSnapshot,
	normalizeRealtimeUsage,
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
		this.onClosed = options.onClosed;

		this.client.on("message", (data, isBinary) => {
			void this.handleClientMessage(data, isBinary);
		});
		this.upstream.on("message", (data) => {
			void this.handleUpstreamMessage(data);
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
				this.shutdown(1000, "session_duration_limit");
			}, maxSessionMs()),
		);

		const ping = setInterval(() => {
			if (!this.clientAlive || !this.upstreamAlive) {
				this.shutdown(1011, "ping_timeout");
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
			default:
				this.forwardToUpstream(text);
		}
	}

	private handleSessionUpdate(message: Record<string, unknown>): void {
		const session =
			message.session && typeof message.session === "object"
				? (message.session as Record<string, unknown>)
				: {};

		// The model is pinned at connection time.
		if (
			typeof session.model === "string" &&
			session.model !== this.preflight.match.mapping.externalId &&
			session.model !== this.preflight.match.modelId
		) {
			this.sendToClientRaw(
				buildErrorEvent(
					"model_locked",
					"The session model is locked at connection time and cannot be changed via session.update.",
				),
			);
			return;
		}

		// Input transcription has a separate billing lifecycle that is not yet
		// metered here, so enabling it is rejected rather than silently unbilled.
		const audio =
			session.audio && typeof session.audio === "object"
				? (session.audio as Record<string, unknown>)
				: undefined;
		const audioInput =
			audio?.input && typeof audio.input === "object"
				? (audio.input as Record<string, unknown>)
				: undefined;
		if (
			(audioInput && audioInput.transcription !== undefined) ||
			session.input_audio_transcription !== undefined
		) {
			this.sendToClientRaw(
				buildErrorEvent(
					"transcription_not_supported",
					"Input audio transcription is not yet supported for realtime sessions on LLMGateway.",
				),
			);
			return;
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

		// Remember the caller's desired auto-response behavior, then force it off
		// upstream so every generation passes through the gateway's gates.
		const turnDetection =
			audioInput && "turn_detection" in audioInput
				? audioInput.turn_detection
				: "turn_detection" in session
					? session.turn_detection
					: undefined;
		let forwarded = message;
		if (turnDetection !== undefined) {
			if (turnDetection === null) {
				this.turnDetectionEnabled = false;
			} else if (typeof turnDetection === "object") {
				this.turnDetectionEnabled = true;
				const td = turnDetection as Record<string, unknown>;
				this.desiredAutoRespond = td.create_response !== false;
				const rewritten = { ...td, create_response: false };
				forwarded = structuredClone(message);
				const fwdSession = forwarded.session as Record<string, unknown>;
				const fwdAudio = fwdSession.audio as
					| Record<string, unknown>
					| undefined;
				const fwdAudioInput = fwdAudio?.input as
					| Record<string, unknown>
					| undefined;
				if (fwdAudioInput && "turn_detection" in fwdAudioInput) {
					fwdAudioInput.turn_detection = rewritten;
				} else {
					fwdSession.turn_detection = rewritten;
				}
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
		}

		const allowed = await this.runGenerationGates();
		if (!allowed) {
			return;
		}
		this.responseInFlight = "pending";
		this.responseStartedAt = Date.now();
		this.forwardToUpstream(JSON.stringify(message));
	}

	private async maybeAutoRespond(): Promise<void> {
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
		this.responseInFlight = "pending";
		this.responseStartedAt = Date.now();
		this.forwardToUpstream(JSON.stringify({ type: "response.create" }));
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

		let freshKey;
		let freshOrg;
		let freshProject;
		try {
			freshKey = await findApiKeyByToken(this.gatewayToken);
			freshOrg = await findOrganizationById(
				this.preflight.project.organizationId,
			);
			freshProject = await findProjectById(this.preflight.project.id);
		} catch (error) {
			// Fail closed for new billable work when billing state is unreadable.
			logger.error("Realtime generation gate lookup failed", error as Error);
			this.sendToClientRaw(
				buildErrorEvent(
					"gate_unavailable",
					"Unable to verify account state; generation is temporarily unavailable.",
				),
			);
			return false;
		}

		if (!freshKey || freshKey.status !== "active") {
			this.sendToClientRaw(
				buildErrorEvent(
					"api_key_revoked",
					"The LLMGateway API key for this session is no longer active.",
				),
			);
			this.shutdown(1008, "api_key_revoked");
			return false;
		}
		try {
			assertApiKeyWithinUsageLimits(freshKey);
		} catch (error) {
			this.sendToClientRaw(
				buildErrorEvent(
					"api_key_limit",
					error instanceof Error
						? error.message
						: "API key usage limit reached.",
				),
			);
			return false;
		}

		if (!freshOrg || freshOrg.status === "deleted") {
			this.sendToClientRaw(
				buildErrorEvent(
					"organization_unavailable",
					"The organization for this session is no longer active.",
				),
			);
			this.shutdown(1008, "organization_unavailable");
			return false;
		}

		if (!freshProject || freshProject.status === "deleted") {
			this.sendToClientRaw(
				buildErrorEvent(
					"project_archived",
					"The project for this session has been archived.",
				),
			);
			this.shutdown(1008, "project_archived");
			return false;
		}

		try {
			await assertMemberWithinBudget(
				freshKey.createdBy,
				this.preflight.project.organizationId,
			);
		} catch (error) {
			this.sendToClientRaw(
				buildErrorEvent(
					"member_budget_exceeded",
					error instanceof Error
						? error.message
						: "Member spend budget reached.",
				),
			);
			return false;
		}

		if (this.preflight.usedMode === "credits") {
			// Subtract only this session's spend the worker has NOT yet settled:
			// once the worker debits a row, the organization balance already
			// reflects it and subtracting it again would double-count.
			const unsettled = await getUnsettledRealtimeSessionSpend(
				this.sessionRecordId,
			).catch((error: unknown) => {
				logger.error(
					"Failed to read unsettled realtime session spend",
					error as Error,
				);
				return null;
			});
			if (unsettled === null) {
				this.sendToClientRaw(
					buildErrorEvent(
						"gate_unavailable",
						"Unable to verify account state; generation is temporarily unavailable.",
					),
				);
				return false;
			}
			const available = new Decimal(getAvailableCredits(freshOrg)).minus(
				unsettled,
			);
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
				this.sendToClientRaw(text);
				// Disable the provider's automatic VAD response so every generation
				// passes the gateway's authorization gates. The echoed
				// session.updated for this control message is suppressed below.
				this.suppressSessionUpdated += 1;
				this.forwardToUpstream(
					JSON.stringify({
						type: "session.update",
						session: {
							type: "realtime",
							audio: {
								input: {
									turn_detection: {
										type: "server_vad",
										create_response: false,
									},
								},
							},
						},
					}),
				);
				return;
			}
			case "session.updated":
				if (this.suppressSessionUpdated > 0) {
					this.suppressSessionUpdated -= 1;
					return;
				}
				this.sendToClientRaw(text);
				return;
			case "response.created": {
				const response =
					event.response && typeof event.response === "object"
						? (event.response as Record<string, unknown>)
						: {};
				this.responseInFlight =
					typeof response.id === "string" ? response.id : "pending";
				this.responseStartedAt = this.responseStartedAt ?? Date.now();
				this.sendToClientRaw(text);
				return;
			}
			case "response.done":
				await this.handleResponseDone(event, text);
				return;
			case "input_audio_buffer.committed":
				this.sendToClientRaw(text);
				void this.maybeAutoRespond();
				return;
			case "error":
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
		// billing path does. Fail closed if the discount can't be resolved: a
		// full-price charge to a discounted customer is a billing error.
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
			// The billable tail event has been captured; the upstream socket can
			// now be released.
			this.shutdown(1000, "client_disconnected");
		}
	}

	// --- Lifecycle ---

	private async handleClientClose(): Promise<void> {
		if (this.finalized || this.draining) {
			return;
		}
		if (this.responseInFlight && this.upstream.readyState === WebSocket.OPEN) {
			// Cancel in-flight work but keep the upstream open briefly to capture
			// the terminal response.done that carries the billable usage.
			this.draining = true;
			this.forwardToUpstream(JSON.stringify({ type: "response.cancel" }));
			this.drainTimer = setTimeout(() => {
				this.shutdown(1000, "client_disconnected_drain_timeout");
			}, drainTimeoutMs());
			return;
		}
		this.shutdown(1000, "client_disconnected");
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
				reason === "unbillable_response"
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
