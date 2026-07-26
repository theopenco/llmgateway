import type { ApiOrigin } from "@llmgateway/db";
import type { Context } from "hono";

/**
 * Carries the caller-facing API surface across the internal
 * `app.request("/v1/chat/completions")` hop that `/v1/messages`, `/v1/responses`
 * and `/v1/images` perform, so their logs are not attributed to chat completions.
 */
export const API_ORIGIN_HEADER = "x-internal-api-origin";

const PROXIED_API_ORIGINS: readonly ApiOrigin[] = [
	"messages",
	"responses",
	"images",
];

/**
 * Resolves the API origin for a chat completions request. Only the origins that
 * reach this handler by internal re-dispatch are accepted from the header;
 * anything else is a direct `/v1/chat/completions` call.
 */
export function resolveChatApiOrigin(c: Context): ApiOrigin {
	const header = c.req.header(API_ORIGIN_HEADER)?.trim() as
		| ApiOrigin
		| undefined;

	return header && PROXIED_API_ORIGINS.includes(header)
		? header
		: "chat-completions";
}
