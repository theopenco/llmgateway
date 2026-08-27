import { shortid } from "@llmgateway/db";

import type { ApiOrigin } from "@llmgateway/db";
import type { Context } from "hono";

/**
 * Carries the caller-facing API surface across the internal
 * `app.request("/v1/chat/completions")` hop that `/v1/messages`, `/v1/responses`
 * and `/v1/images` perform, so their logs are not attributed to chat completions.
 */
export const API_ORIGIN_HEADER = "x-internal-api-origin";

/**
 * Proves the header was set by this process on an internal re-dispatch rather
 * than by an external caller, who could otherwise mislabel their own logs by
 * sending the header on a direct `/v1/chat/completions` call. `app.request()`
 * never leaves the process, so a token that only lives in this module is
 * sufficient — it is never persisted, logged, or echoed back to clients.
 */
const INTERNAL_ORIGIN_TOKEN = shortid(24);

const PROXIED_API_ORIGINS: readonly ApiOrigin[] = [
	"messages",
	"responses",
	"images",
	"ai-sdk",
];

/**
 * Headers that tag an internal `app.request()` hop with the API surface the
 * original caller used. Spread into the forwarded header set.
 */
export function internalApiOriginHeaders(
	origin: ApiOrigin,
): Record<string, string> {
	return { [API_ORIGIN_HEADER]: `${INTERNAL_ORIGIN_TOKEN}:${origin}` };
}

/**
 * Whether a request is a trusted internal `app.request()` re-dispatch from this
 * process (vs. an external caller). True only when the origin header carries
 * this process's internal token, so a spoofed header from an external caller
 * returns false. Used to skip re-applying the org rate limiter to the internal
 * chat-completions hop that messages/responses/images already counted.
 */
export function isInternalApiOrigin(c: Pick<Context, "req">): boolean {
	const header = c.req.header(API_ORIGIN_HEADER)?.trim();
	if (!header) {
		return false;
	}
	const separator = header.indexOf(":");
	return (
		separator !== -1 && header.slice(0, separator) === INTERNAL_ORIGIN_TOKEN
	);
}

/**
 * Resolves the API origin for a chat completions request. The header is honored
 * only when it carries this process's internal token and names an origin that
 * actually re-dispatches through here; anything else — including a spoofed
 * header — is treated as a direct `/v1/chat/completions` call.
 */
export function resolveChatApiOrigin(c: Context): ApiOrigin {
	const header = c.req.header(API_ORIGIN_HEADER)?.trim();
	if (!header) {
		return "chat-completions";
	}

	const separator = header.indexOf(":");
	if (
		separator === -1 ||
		header.slice(0, separator) !== INTERNAL_ORIGIN_TOKEN
	) {
		return "chat-completions";
	}

	const origin = header.slice(separator + 1) as ApiOrigin;

	return PROXIED_API_ORIGINS.includes(origin) ? origin : "chat-completions";
}
