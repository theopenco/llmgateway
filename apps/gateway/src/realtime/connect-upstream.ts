import { WebSocket } from "ws";

import {
	getAzureCredentialBaseUrl,
	getCredentialSetting,
} from "@/chat/tools/resolve-platform-credential.js";

import {
	assertSafeUserUrl,
	isProviderUrlGuardEnabled,
} from "@llmgateway/shared";
import { safeOutboundLookup } from "@llmgateway/shared/url-safety-node";

import { RealtimeConnectError } from "./errors.js";
import { getRealtimeUpstreamModel } from "./upstream-model.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { Provider } from "@llmgateway/models";
import type { ClientRequest, IncomingMessage } from "node:http";

const maxMessageBytes = () =>
	Number(process.env.REALTIME_MAX_MESSAGE_BYTES) || 8 * 1024 * 1024;
const upstreamHandshakeTimeoutMs = () =>
	Number(process.env.REALTIME_UPSTREAM_HANDSHAKE_TIMEOUT_MS) || 10_000;

const GEMINI_LIVE_PATH =
	"/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export interface UpstreamConnectOptions {
	/**
	 * Provider session parameters forwarded on the upstream URL, for providers
	 * configured at connection time (ElevenLabs).
	 */
	query?: URLSearchParams;
}

export interface UpstreamTarget {
	url: string;
	headers: Record<string, string>;
}

/**
 * Provider-specific upstream endpoint and credential headers. Credentials
 * always travel in headers, never in the query string, so they cannot leak
 * into provider access logs or proxies.
 */
export function resolveUpstreamTarget(
	preflight: RealtimePreflightResult,
	options: UpstreamConnectOptions = {},
): UpstreamTarget {
	const providerId = preflight.match.mapping.providerId as Provider;

	// Base URL of the credential serving the session: the managed credential's
	// own config when one is active, the provider's env var on the env path. A
	// BYOK key never inherits an env or managed proxy. Azure may use its own
	// resource or public HTTPS base URL, guarded again when the socket opens.
	const credentialBaseUrl =
		providerId === "azure"
			? undefined
			: getCredentialSetting(
					providerId,
					"baseUrl",
					{
						providerKey: preflight.providerKey,
						managedKey: preflight.managedKey,
					},
					{ configIndex: preflight.configIndex, variant: preflight.envVariant },
				)?.replace(/\/+$/, "");

	if (providerId === "google-ai-studio") {
		const baseUrl =
			credentialBaseUrl ?? "https://generativelanguage.googleapis.com";
		return {
			url: `${baseUrl.replace(/^http/, "ws")}${GEMINI_LIVE_PATH}`,
			headers: {
				// The header form is what Google's own SDK uses for Live WebSocket
				// connections; the `key` query parameter is deliberately not used.
				"x-goog-api-key": preflight.upstreamToken,
			},
		};
	}

	if (providerId === "elevenlabs") {
		// Scribe Live is configured by query parameters; the gateway validated
		// them before connecting (buildElevenLabsRealtimeConfig).
		const baseUrl = credentialBaseUrl ?? "https://api.elevenlabs.io";
		const query = new URLSearchParams(options.query);
		query.set("model_id", preflight.match.mapping.externalId);
		return {
			url: `${baseUrl.replace(/^http/, "ws")}/v1/speech-to-text/realtime?${query.toString()}`,
			headers: { "xi-api-key": preflight.upstreamToken },
		};
	}

	if (providerId === "xai") {
		// xAI speaks the OpenAI realtime protocol; OpenAI-only headers such as
		// the safety identifier are not forwarded.
		const baseUrl = credentialBaseUrl ?? "https://api.x.ai";
		return {
			url: `${baseUrl.replace(/^http/, "ws")}/v1/realtime?model=${encodeURIComponent(preflight.match.mapping.externalId)}`,
			headers: {
				Authorization: `Bearer ${preflight.upstreamToken}`,
			},
		};
	}

	// A transcription session has no session model in the URL: the ASR model
	// is applied by the gateway's control session.update once connected.
	const query =
		preflight.sessionType === "transcription"
			? "intent=transcription"
			: `model=${encodeURIComponent(getRealtimeUpstreamModel(preflight))}`;

	if (providerId === "azure") {
		// Azure serves the OpenAI realtime protocol on the resource's v1 API,
		// addressing the deployment by name through the same model parameter.
		const baseUrl = getAzureCredentialBaseUrl(
			{ providerKey: preflight.providerKey, managedKey: preflight.managedKey },
			{ configIndex: preflight.configIndex, variant: preflight.envVariant },
		);
		if (!baseUrl) {
			throw new RealtimeConnectError(
				500,
				"upstream_config_missing",
				"Azure requires a resource or a base URL for realtime sessions.",
			);
		}
		return {
			url: `${baseUrl.replace(/^http/, "ws")}/openai/v1/realtime?${query}`,
			headers: { "api-key": preflight.upstreamToken },
		};
	}

	const baseUrl = credentialBaseUrl ?? "https://api.openai.com";
	return {
		url: `${baseUrl.replace(/^http/, "ws")}/v1/realtime?${query}`,
		headers: {
			Authorization: `Bearer ${preflight.upstreamToken}`,
			...(preflight.usedMode === "credits" &&
				preflight.safetyIdentifier !== undefined && {
					"OpenAI-Safety-Identifier": preflight.safetyIdentifier,
				}),
		},
	};
}

/**
 * Open the upstream provider WebSocket for a preflighted session. Resolves
 * once the upstream handshake completes (with the socket paused so no server
 * event is lost before the proxy session attaches its listeners).
 */
export async function connectUpstream(
	preflight: RealtimePreflightResult,
	options: UpstreamConnectOptions = {},
): Promise<WebSocket> {
	const target = resolveUpstreamTarget(preflight, options);
	const guardTenantTarget =
		Boolean(preflight.providerKey) && isProviderUrlGuardEnabled();
	if (guardTenantTarget) {
		try {
			const url = new URL(target.url);
			if (
				!["wss:", "https:"].includes(url.protocol) ||
				url.username ||
				url.password
			) {
				throw new Error("Unsafe realtime target");
			}
			url.protocol = "https:";
			assertSafeUserUrl(url.href);
		} catch {
			throw new RealtimeConnectError(
				400,
				"invalid_base_url",
				"Realtime provider URLs must use public HTTPS hosts without URL credentials.",
			);
		}
	}
	const handshakeTimeout = upstreamHandshakeTimeoutMs();
	const timeoutError = () =>
		new RealtimeConnectError(
			504,
			"upstream_connect_timeout",
			"Realtime provider connection timed out.",
		);
	const upstream = new WebSocket(target.url, {
		headers: target.headers,
		maxPayload: maxMessageBytes(),
		handshakeTimeout,
		followRedirects: false,
		...(guardTenantTarget && { lookup: safeOutboundLookup }),
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
			discardUpstream(upstream);
			if (
				guardTenantTarget &&
				(error as NodeJS.ErrnoException).code === "EACCES"
			) {
				reject(
					new RealtimeConnectError(
						400,
						"invalid_base_url",
						"Realtime provider URLs must resolve to public addresses.",
					),
				);
			} else if (
				(error as NodeJS.ErrnoException).code === "ETIMEDOUT" ||
				error.message === "Opening handshake has timed out"
			) {
				reject(timeoutError());
			} else {
				reject(error);
			}
		};
		const onUnexpected = (
			upstreamReq: ClientRequest,
			upstreamRes: IncomingMessage,
		) => {
			cleanup();
			// With an unexpected-response listener attached, ws does not abort the
			// handshake itself — this listener owns the request. The request's own
			// error handler re-emits on the WebSocket, which has no listeners after
			// cleanup(), so absorb that first, then discard the response and destroy
			// the request so a rejected handshake cannot leak the connection.
			upstream.on("error", () => {});
			upstreamRes.resume();
			upstreamReq.destroy();
			reject(
				new RealtimeConnectError(
					502,
					"upstream_connect_failed",
					`Upstream provider rejected the realtime connection (status ${upstreamRes.statusCode ?? "unknown"}).`,
				),
			);
		};
		const cleanup = () => {
			clearTimeout(timer);
			upstream.off("open", onOpen);
			upstream.off("error", onError);
			upstream.off("unexpected-response", onUnexpected);
		};
		// Keep a wall-clock deadline alongside the transport's request timeout.
		const timer = setTimeout(() => onError(timeoutError()), handshakeTimeout);
		upstream.on("open", onOpen);
		upstream.on("error", onError);
		upstream.on("unexpected-response", onUnexpected);
	});

	return upstream;
}

/**
 * Tear down an upstream socket that never reached a proxy session.
 * connectUpstream() drops its handshake listeners once the socket is open and
 * the session that would own them is never constructed on these paths, so an
 * error listener has to be re-attached before terminating.
 */
export function discardUpstream(upstream: WebSocket): void {
	upstream.on("error", () => {
		// This socket is being thrown away; nothing left to report.
	});
	upstream.terminate();
}
