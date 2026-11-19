import { shortid } from "@llmgateway/db";

import type { ProviderId } from "@llmgateway/models";

/**
 * Request header each provider documents for a caller-chosen request id.
 * Providers without one get no header.
 */
const CLIENT_REQUEST_ID_HEADERS: Partial<Record<ProviderId, string>> = {
	openai: "X-Client-Request-Id",
	azure: "x-ms-client-request-id",
};

const MAX_UPSTREAM_REQUEST_ID_LENGTH = 128;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

export function getUpstreamClientRequestIdHeader(
	provider: ProviderId,
): string | undefined {
	return CLIENT_REQUEST_ID_HEADERS[provider];
}

/**
 * A fresh gateway-generated id for one upstream attempt (`lgr_` + 20 base62
 * chars), or null when the provider takes no client request id. Never derive
 * it from client input: provider reports quote it to find the log row.
 */
export function createUpstreamClientRequestId(
	provider: ProviderId,
): string | null {
	return getUpstreamClientRequestIdHeader(provider)
		? `lgr_${shortid(20)}`
		: null;
}

/**
 * The provider's own request id (`x-request-id`) from an upstream response,
 * for providers that also take a client request id.
 */
export function getUpstreamRequestId(
	provider: ProviderId,
	headers: Headers | null | undefined,
): string | null {
	if (!headers || !getUpstreamClientRequestIdHeader(provider)) {
		return null;
	}
	const value = headers.get("x-request-id")?.trim();
	if (
		!value ||
		value.length > MAX_UPSTREAM_REQUEST_ID_LENGTH ||
		!PRINTABLE_ASCII.test(value)
	) {
		return null;
	}
	return value;
}
