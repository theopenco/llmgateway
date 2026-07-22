import { WebSocket, WebSocketServer } from "ws";

import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";

import { logger } from "@llmgateway/logger";
import { getProviderEnvValue, type Provider } from "@llmgateway/models";

import {
	closeRealtimeSessionRecord,
	createRealtimeSessionRecord,
} from "./billing.js";
import { RealtimeConnectError } from "./errors.js";
import { acquireRealtimeLease, releaseRealtimeLease } from "./leases.js";
import { runRealtimePreflight } from "./preflight.js";
import { RealtimeProxySession } from "./session.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

const maxMessageBytes = () =>
	Number(process.env.REALTIME_MAX_MESSAGE_BYTES) || 8 * 1024 * 1024;
const upstreamHandshakeTimeoutMs = () =>
	Number(process.env.REALTIME_UPSTREAM_HANDSHAKE_TIMEOUT_MS) || 10_000;

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
		socket.write(
			`HTTP/1.1 ${status} ${statusText[status] ?? "Error"}\r\n` +
				"Content-Type: application/json\r\n" +
				`Content-Length: ${Buffer.byteLength(body)}\r\n` +
				"Connection: close\r\n" +
				"\r\n" +
				body,
		);
	} catch {
		// Socket already gone.
	}
	socket.destroy();
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

function extractClientIp(req: IncomingMessage): string | undefined {
	const forwarded = req.headers["x-forwarded-for"];
	if (typeof forwarded === "string" && forwarded.length > 0) {
		return forwarded.split(",")[0].trim();
	}
	return req.socket.remoteAddress ?? undefined;
}

/**
 * Open the upstream provider WebSocket for a preflighted session. Resolves
 * once the upstream handshake completes (with the socket paused so no server
 * event is lost before the proxy session attaches its listeners).
 */
async function connectUpstream(
	preflight: RealtimePreflightResult,
): Promise<WebSocket> {
	const providerId = preflight.match.mapping.providerId as Provider;
	const baseUrl =
		getProviderEnvValue(providerId, "baseUrl", preflight.configIndex) ??
		"https://api.openai.com";
	const url = `${baseUrl.replace(/^http/, "ws")}/v1/realtime?model=${encodeURIComponent(preflight.match.mapping.externalId)}`;

	const upstream = new WebSocket(url, {
		headers: {
			Authorization: `Bearer ${preflight.upstreamToken}`,
			"OpenAI-Safety-Identifier": preflight.safetyIdentifier,
		},
		maxPayload: maxMessageBytes(),
		handshakeTimeout: upstreamHandshakeTimeoutMs(),
	});

	await new Promise<void>((resolve, reject) => {
		const onOpen = () => {
			cleanup();
			// Hold incoming events until the proxy session attaches listeners.
			upstream.pause();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onUnexpected = (res: IncomingMessage) => {
			cleanup();
			reject(
				new RealtimeConnectError(
					502,
					"upstream_connect_failed",
					`Upstream provider rejected the realtime connection (status ${res.statusCode ?? "unknown"}).`,
				),
			);
		};
		const cleanup = () => {
			upstream.off("open", onOpen);
			upstream.off("error", onError);
			upstream.off("unexpected-response", onUnexpected);
		};
		upstream.on("open", onOpen);
		upstream.on("error", onError);
		upstream.on("unexpected-response", onUnexpected);
	});

	return upstream;
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
	});
	const sessions = new Set<RealtimeProxySession>();
	let accepting = true;

	server.on("upgrade", (req, socket, head) => {
		void (async () => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (url.pathname !== "/v1/realtime") {
				writeHttpError(socket, 404, "not_found", "Unknown WebSocket path");
				return;
			}
			// Kill switch: stop new sessions while existing sessions drain.
			if (!accepting || process.env.REALTIME_DISABLED === "true") {
				writeHttpError(
					socket,
					503,
					"realtime_disabled",
					"Realtime sessions are temporarily unavailable.",
				);
				return;
			}

			const token = extractToken(req);
			const requestedModel = url.searchParams.get("model") ?? undefined;

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
				if (preflight.providerKey?.id) {
					reportTrackedKeyError(
						preflight.providerKey.id,
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
			if (preflight.providerKey?.id) {
				reportTrackedKeySuccess(
					preflight.providerKey.id,
					preflight.match.modelId,
				);
			}

			// From here on, an unexpected failure must not orphan the upstream
			// socket, the lease, or the session record.
			socket.on("error", () => {
				// Errors on the raw socket pre-upgrade are handled by ws.
			});
			try {
				wss.handleUpgrade(req, socket, head, (clientSocket) => {
					const session = new RealtimeProxySession({
						clientSocket,
						upstreamSocket: upstream,
						preflight,
						gatewayToken: token!,
						requestedModel: requestedModel!,
						sessionRecordId: sessionRecord.id,
						lease,
						source: null,
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
				upstream.terminate();
				await releaseRealtimeLease(lease);
				await abortSession("upgrade_failed");
				throw error;
			}
		})().catch((error: unknown) => {
			logger.error("Realtime upgrade handling failed", error as Error);
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
				session.shutdown(code, reason);
			}
		},
	};
}
