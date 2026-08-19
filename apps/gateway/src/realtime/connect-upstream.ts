import { WebSocket } from "ws";

import { getCredentialSetting } from "@/chat/tools/resolve-platform-credential.js";

import { RealtimeConnectError } from "./errors.js";

import type { RealtimePreflightResult } from "./preflight.js";
import type { Provider } from "@llmgateway/models";
import type { ClientRequest, IncomingMessage } from "node:http";

const maxMessageBytes = () =>
	Number(process.env.REALTIME_MAX_MESSAGE_BYTES) || 8 * 1024 * 1024;
const upstreamHandshakeTimeoutMs = () =>
	Number(process.env.REALTIME_UPSTREAM_HANDSHAKE_TIMEOUT_MS) || 10_000;

const GEMINI_LIVE_PATH =
	"/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

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
): UpstreamTarget {
	const providerId = preflight.match.mapping.providerId as Provider;

	// Base URL of the platform credential serving the session: the managed
	// credential's own config when one is active, the provider's env var
	// otherwise. BYOK base URLs are rejected in preflight.
	const credentialBaseUrl = getCredentialSetting(
		providerId,
		"baseUrl",
		preflight.managedKey,
		{ configIndex: preflight.configIndex, variant: preflight.envVariant },
	);

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

	const baseUrl = credentialBaseUrl ?? "https://api.openai.com";
	return {
		url: `${baseUrl.replace(/^http/, "ws")}/v1/realtime?model=${encodeURIComponent(preflight.match.mapping.externalId)}`,
		headers: {
			Authorization: `Bearer ${preflight.upstreamToken}`,
			"OpenAI-Safety-Identifier": preflight.safetyIdentifier,
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
): Promise<WebSocket> {
	const target = resolveUpstreamTarget(preflight);

	const upstream = new WebSocket(target.url, {
		headers: target.headers,
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
