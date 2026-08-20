import { WebSocketServer } from "ws";

import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";
import { getClientIpFromForwardedFor } from "@/lib/client-ip.js";

import { logger } from "@llmgateway/logger";

import {
	closeRealtimeSessionRecord,
	createRealtimeSessionRecord,
} from "./billing.js";
import {
	findRealtimeMapping,
	findRealtimeTranscriptionMapping,
} from "./catalog.js";
import {
	CLIENT_SECRET_PREFIX,
	getClientSecretRecord,
} from "./client-secrets.js";
import { connectUpstream, discardUpstream } from "./connect-upstream.js";
import { RealtimeConnectError } from "./errors.js";
import { GeminiRealtimeProxySession } from "./gemini-session.js";
import { acquireRealtimeLease, releaseRealtimeLease } from "./leases.js";
import { runRealtimePreflight } from "./preflight.js";
import { RealtimeProxySession } from "./session.js";

import type { RealtimeMappingMatch } from "./catalog.js";
import type { RealtimePreflightResult } from "./preflight.js";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";

const maxMessageBytes = () =>
	Number(process.env.REALTIME_MAX_MESSAGE_BYTES) || 8 * 1024 * 1024;

/**
 * Any live proxy session, regardless of upstream protocol. The server only
 * ever needs to count sessions and force-close them during shutdown.
 */
interface ShutdownableSession {
	/**
	 * Force-close the session. Implementations settle any billable work that is
	 * still outstanding before finalizing, so a server drain cannot drop a
	 * charge the provider has already made.
	 */
	close: (code: number, reason: string) => void;
}

export function realtimeModelIdsMatch(
	requestedModel: string,
	pinnedModel: string,
): boolean {
	if (requestedModel === pinnedModel) {
		return true;
	}
	const requestedMatch = findRealtimeMapping(requestedModel);
	const pinnedMatch = findRealtimeMapping(pinnedModel);
	return (
		requestedMatch !== null &&
		pinnedMatch !== null &&
		requestedMatch.modelId === pinnedMatch.modelId &&
		requestedMatch.mapping.providerId === pinnedMatch.mapping.providerId &&
		requestedMatch.mapping.region === pinnedMatch.mapping.region
	);
}

function writeHttpError(
	socket: Duplex,
	status: number,
	code: string,
	message: string,
): void {
	const statusText: Record<number, string> = {
		400: "Bad Request",
		401: "Unauthorized",
		402: "Payment Required",
		403: "Forbidden",
		404: "Not Found",
		410: "Gone",
		429: "Too Many Requests",
		500: "Internal Server Error",
		502: "Bad Gateway",
		503: "Service Unavailable",
	};
	const body = JSON.stringify({
		error: {
			message,
			type: "invalid_request_error",
			param: null,
			code,
		},
	});
	try {
		// end() + destroy-on-finish (ws's own abortHandshake pattern): a
		// synchronous destroy() can discard the response before it reaches the
		// kernel, turning the crafted error into a bare connection reset.
		socket.once("finish", () => socket.destroy());
		socket.end(
			`HTTP/1.1 ${status} ${statusText[status] ?? "Error"}\r\n` +
				"Content-Type: application/json\r\n" +
				`Content-Length: ${Buffer.byteLength(body)}\r\n` +
				"Connection: close\r\n" +
				"\r\n" +
				body,
		);
	} catch {
		// Socket already gone.
		socket.destroy();
	}
}

function extractToken(req: IncomingMessage): string | undefined {
	const auth = req.headers.authorization;
	if (auth) {
		const split = auth.split("Bearer ");
		if (split.length === 2 && split[1]) {
			return split[1];
		}
	}
	const xApiKey = req.headers["x-api-key"];
	if (typeof xApiKey === "string" && xApiKey) {
		return xApiKey;
	}
	return undefined;
}

/**
 * Offered WebSocket subprotocols, parsed from the (possibly repeated)
 * Sec-WebSocket-Protocol header.
 */
function parseOfferedSubprotocols(req: IncomingMessage): string[] {
	const header = req.headers["sec-websocket-protocol"];
	const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/**
 * Browser subprotocol conventions that may carry an ephemeral client secret.
 * The "openai-insecure-api-key." form is the official OpenAI one; the
 * "llmgateway-insecure-api-key." form is the provider-neutral alias, used by
 * clients (such as the Gemini playground hook) that do not speak the OpenAI
 * realtime protocol at all.
 */
const INSECURE_API_KEY_SUBPROTOCOL_PREFIXES = [
	"openai-insecure-api-key.",
	"llmgateway-insecure-api-key.",
] as const;

export function extractSubprotocolSecret(
	protocols: string[],
): string | undefined {
	for (const protocol of protocols) {
		for (const prefix of INSECURE_API_KEY_SUBPROTOCOL_PREFIXES) {
			if (protocol.startsWith(prefix)) {
				return protocol.slice(prefix.length);
			}
		}
	}
	return undefined;
}

/**
 * Validated x-source header for direct (non-secret) connections. Invalid
 * values are ignored rather than failing the upgrade.
 */
function extractSource(req: IncomingMessage): string | null {
	const raw = req.headers["x-source"];
	const value = Array.isArray(raw) ? raw[0] : raw;
	if (!value) {
		return null;
	}
	const normalized = value.replace(/^https?:\/\//, "").replace(/^www\./, "");
	return /^[a-zA-Z0-9./-]+$/.test(normalized) ? normalized : null;
}

/**
 * Originating client IP for IAM evaluation. Deliberately identical to the HTTP
 * endpoints' resolution (the shared X-Forwarded-For helper) and with no
 * socket-address fallback: behind a load balancer that fallback is the balancer
 * itself, which must never be matched against a customer's CIDR allowlist.
 */
function extractClientIp(req: IncomingMessage): string | undefined {
	const forwarded = req.headers["x-forwarded-for"];
	return getClientIpFromForwardedFor(
		Array.isArray(forwarded) ? forwarded.join(",") : forwarded,
	);
}

export interface RealtimeServer {
	/**
	 * Number of currently active proxy sessions.
	 */
	sessionCount: () => number;
	/**
	 * Stop accepting new sessions. Existing sessions keep draining; call
	 * closeAll() to force-terminate them.
	 */
	stopAccepting: () => void;
	closeAll: (code: number, reason: string) => void;
}

/**
 * Attach the /v1/realtime WebSocket upgrade handler to an HTTP server.
 * Authentication, catalogue resolution, credit checks, concurrency leases and
 * the upstream handshake all complete BEFORE the client upgrade is accepted,
 * so a rejected connection gets a proper HTTP status instead of an opaque
 * handshake failure.
 */
export function attachRealtimeServer(server: Server): RealtimeServer {
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: maxMessageBytes(),
		// Select only the public "realtime" subprotocol; the credential-bearing
		// "*-insecure-api-key.*" subprotocols must never be echoed back.
		handleProtocols: (protocols) =>
			protocols.has("realtime") ? "realtime" : false,
	});
	const sessions = new Set<ShutdownableSession>();
	let accepting = true;

	server.on("upgrade", (req, socket, head) => {
		// Node removes its own 'error' listener before emitting 'upgrade', so this
		// must be the first statement: a client reset during the multi-second
		// preflight + upstream handshake window would otherwise be an unhandled
		// 'error' event, i.e. an uncaughtException that drains the whole process
		// and kills every live session.
		socket.on("error", (error: Error) => {
			logger.warn("Realtime upgrade socket error", { error: error.message });
		});
		// Tracked out here so the terminal catch can tell a pre-handshake failure
		// (answerable with an HTTP error) from a post-101 one (where the socket
		// already carries WebSocket frames).
		let upgraded = false;
		void (async () => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname !== "/v1/realtime") {
				writeHttpError(socket, 404, "not_found", "Unknown WebSocket path");
				return;
			}
			// Kill switch: stop new sessions while existing sessions drain.
			if (
				!accepting ||
				process.env.REALTIME_DISABLED === "true" ||
				process.env.REALTIME_ENABLED === "false"
			) {
				writeHttpError(
					socket,
					503,
					"realtime_disabled",
					"Realtime sessions are temporarily unavailable.",
				);
				return;
			}

			// Credentials must never travel in the URL: they leak into logs,
			// proxies, and browser history.
			if (
				url.searchParams.has("token") ||
				url.searchParams.has("client_secret") ||
				url.searchParams.has("api_key")
			) {
				writeHttpError(
					socket,
					400,
					"credentials_in_query",
					"Credentials must not be passed as query parameters. Use the Authorization header or the openai-insecure-api-key WebSocket subprotocol.",
				);
				return;
			}

			const headerToken = extractToken(req);
			const offeredProtocols = parseOfferedSubprotocols(req);
			const subprotocolSecret = extractSubprotocolSecret(offeredProtocols);

			if (headerToken && subprotocolSecret) {
				writeHttpError(
					socket,
					400,
					"conflicting_credentials",
					"Provide either an Authorization/x-api-key header or an openai-insecure-api-key subprotocol, not both.",
				);
				return;
			}

			let token = headerToken;
			let requestedModel = url.searchParams.get("model") ?? undefined;
			let source = extractSource(req);
			let secretTranscriptionModel: string | null = null;

			if (subprotocolSecret) {
				if (!subprotocolSecret.startsWith(CLIENT_SECRET_PREFIX)) {
					writeHttpError(
						socket,
						401,
						"invalid_client_secret",
						"The provided realtime client secret is invalid.",
					);
					return;
				}
				let record;
				try {
					record = await getClientSecretRecord(subprotocolSecret);
				} catch (error) {
					if (error instanceof RealtimeConnectError) {
						writeHttpError(socket, error.status, error.code, error.message);
						return;
					}
					throw error;
				}
				if (!record) {
					writeHttpError(
						socket,
						401,
						"invalid_client_secret",
						"The provided realtime client secret is unknown or has expired.",
					);
					return;
				}
				if (
					requestedModel &&
					!realtimeModelIdsMatch(requestedModel, record.model)
				) {
					writeHttpError(
						socket,
						400,
						"model_mismatch",
						"The requested model does not match the model this client secret was minted for.",
					);
					return;
				}
				requestedModel = record.model;
				token = record.token;
				source = record.source;
				secretTranscriptionModel = record.transcriptionModel;
			}

			// Full preflight runs against the WebSocket request's actual client IP:
			// mint-time preflight is only an early error path, this one is the
			// authority for revocation, IAM, credits, and races.
			let preflight: RealtimePreflightResult;
			try {
				preflight = await runRealtimePreflight({
					token,
					requestedModel,
					clientIp: extractClientIp(req),
				});
			} catch (error) {
				if (error instanceof RealtimeConnectError) {
					writeHttpError(socket, error.status, error.code, error.message);
					return;
				}
				logger.error("Realtime preflight failed", error as Error);
				writeHttpError(socket, 500, "internal_error", "Internal server error");
				return;
			}

			// Resolve/validate a pinned transcription model against the session's
			// resolved upstream provider now that preflight determined it. A
			// mapping deactivated since mint time invalidates the pin.
			let allowedTranscription: RealtimeMappingMatch | null = null;
			if (secretTranscriptionModel) {
				allowedTranscription = findRealtimeTranscriptionMapping(
					secretTranscriptionModel,
					preflight.match.mapping.providerId,
				);
				if (!allowedTranscription) {
					writeHttpError(
						socket,
						400,
						"transcription_model_not_supported",
						"The transcription model pinned by this client secret is no longer available.",
					);
					return;
				}
				// IAM rules may have changed since the secret was minted; reject the
				// upgrade now rather than failing the client's first session.update.
				if (
					!preflight.allowedTranscriptionModelIds.includes(
						allowedTranscription.modelId,
					)
				) {
					writeHttpError(
						socket,
						403,
						"transcription_model_not_allowed",
						"This API key is not allowed to use the transcription model pinned by this client secret.",
					);
					return;
				}
			}

			const sessionRecord = await createRealtimeSessionRecord(
				preflight,
				requestedModel!,
			).catch((error: unknown) => {
				logger.error(
					"Failed to create realtime session record",
					error as Error,
				);
				return null;
			});
			if (!sessionRecord) {
				// Fail closed: without a durable session record there is no billing
				// anchor for the events this session would produce.
				writeHttpError(
					socket,
					503,
					"billing_unavailable",
					"Realtime sessions are temporarily unavailable.",
				);
				return;
			}

			const lease = {
				sessionId: sessionRecord.id,
				organizationId: preflight.project.organizationId,
				apiKeyId: preflight.apiKey.id,
			};

			// Any failure after the session record exists must finalize it so no
			// row is left permanently "open" for a session that never started.
			const abortSession = async (closeReason: string) => {
				await closeRealtimeSessionRecord(
					sessionRecord.id,
					"error",
					closeReason,
					{
						bytesIn: 0,
						bytesOut: 0,
					},
				).catch((error: unknown) => {
					logger.error(
						"Failed to finalize aborted realtime session record",
						error as Error,
					);
				});
			};

			try {
				await acquireRealtimeLease(lease);
			} catch (error) {
				if (error instanceof RealtimeConnectError) {
					await abortSession(error.code);
					writeHttpError(socket, error.status, error.code, error.message);
					return;
				}
				await abortSession("lease_error");
				throw error;
			}

			let upstream: WebSocket;
			try {
				upstream = await connectUpstream(preflight);
			} catch (error) {
				await releaseRealtimeLease(lease);
				await abortSession("upstream_connect_failed");
				if (preflight.envVarName !== undefined) {
					reportKeyError(
						preflight.envVarName,
						preflight.configIndex,
						0,
						undefined,
						preflight.match.modelId,
					);
				}
				if (preflight.trackedKeyHealthId) {
					reportTrackedKeyError(
						preflight.trackedKeyHealthId,
						0,
						undefined,
						preflight.match.modelId,
					);
				}
				logger.error("Realtime upstream connect failed", error as Error);
				if (error instanceof RealtimeConnectError) {
					writeHttpError(socket, error.status, error.code, error.message);
				} else {
					writeHttpError(
						socket,
						502,
						"upstream_connect_failed",
						"Failed to connect to the upstream realtime provider.",
					);
				}
				return;
			}

			if (preflight.envVarName !== undefined) {
				reportKeySuccess(
					preflight.envVarName,
					preflight.configIndex,
					preflight.match.modelId,
				);
			}
			if (preflight.trackedKeyHealthId) {
				reportTrackedKeySuccess(
					preflight.trackedKeyHealthId,
					preflight.match.modelId,
				);
			}

			// The accepting check at the top of this handler ran before the
			// preflight and upstream-handshake awaits. A shutdown that began
			// during that window has already seen sessionCount() === 0 and moved
			// on to closing the database, so a session admitted now would run
			// against a closed pool. Nothing awaits between this re-check and
			// sessions.add() below, so a session either registers before the
			// drain loop's next count or is rejected here.
			if (!accepting) {
				discardUpstream(upstream);
				await releaseRealtimeLease(lease);
				await abortSession("server_shutdown");
				writeHttpError(
					socket,
					503,
					"realtime_disabled",
					"Realtime sessions are temporarily unavailable.",
				);
				return;
			}

			// From here on, an unexpected failure must not orphan the upstream
			// socket, the lease, or the session record.
			try {
				wss.handleUpgrade(req, socket, head, (clientSocket) => {
					upgraded = true;
					// Gemini Live speaks its own wire protocol end to end, so it gets a
					// sibling session implementation rather than protocol translation.
					const session: ShutdownableSession =
						preflight.match.mapping.providerId === "google-ai-studio"
							? new GeminiRealtimeProxySession({
									clientSocket,
									upstreamSocket: upstream,
									preflight,
									gatewayToken: token!,
									requestedModel: requestedModel!,
									sessionRecordId: sessionRecord.id,
									lease,
									source,
									userAgent: req.headers["user-agent"],
									onClosed: (closed) => {
										sessions.delete(closed);
									},
								})
							: new RealtimeProxySession({
									clientSocket,
									upstreamSocket: upstream,
									preflight,
									gatewayToken: token!,
									requestedModel: requestedModel!,
									sessionRecordId: sessionRecord.id,
									lease,
									source,
									allowedTranscription,
									userAgent: req.headers["user-agent"],
									onClosed: (closed) => {
										sessions.delete(closed);
									},
								});
					sessions.add(session);
					// Release the buffered upstream events (session.created etc.) now
					// that the proxy listeners are attached.
					upstream.resume();
					logger.info("Realtime session opened", {
						sessionId: sessionRecord.id,
						organizationId: preflight.project.organizationId,
						model: preflight.match.modelId,
						usedMode: preflight.usedMode,
					});
				});
			} catch (error) {
				discardUpstream(upstream);
				await releaseRealtimeLease(lease);
				await abortSession("upgrade_failed");
				throw error;
			}
			// ws aborts the handshake WITHOUT throwing on several paths — most
			// commonly a client that vanished during the preflight window (its
			// completeUpgrade() destroys a non-readable/writable socket), plus
			// malformed Sec-WebSocket-* headers. The callback is invoked
			// synchronously when it is invoked at all (no verifyClient is
			// configured), so a callback that never ran means failure, and the
			// upstream socket, lease and session row must not be orphaned.
			if (!upgraded) {
				logger.warn("Realtime upgrade aborted before completion", {
					sessionId: sessionRecord.id,
				});
				discardUpstream(upstream);
				await releaseRealtimeLease(lease);
				await abortSession("upgrade_aborted");
			}
		})().catch((error: unknown) => {
			logger.error("Realtime upgrade handling failed", error as Error);
			if (upgraded) {
				// ws already wrote the 101 response; an HTTP body here would be
				// framed as WebSocket data.
				socket.destroy();
				return;
			}
			writeHttpError(socket, 500, "internal_error", "Internal server error");
		});
	});

	return {
		sessionCount: () => sessions.size,
		stopAccepting: () => {
			accepting = false;
		},
		closeAll: (code, reason) => {
			for (const session of [...sessions]) {
				session.close(code, reason);
			}
		},
	};
}
