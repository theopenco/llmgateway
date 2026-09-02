import { cors } from "hono/cors";

import type { MiddlewareHandler } from "hono";

/**
 * Parses the comma-separated `GATEWAY_CORS_ORIGINS` allowlist. Entries are full
 * origins (`https://www.typingmind.com`) and may use a leading wildcard label
 * (`https://*.typingmind.com`) to match any subdomain of that host.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

export function isAllowedOrigin(
	allowedOrigins: string[],
	origin: string,
): boolean {
	return allowedOrigins.some((pattern) => {
		if (pattern === origin) {
			return true;
		}

		const wildcardIndex = pattern.indexOf("://*.");
		if (wildcardIndex === -1) {
			return false;
		}

		const scheme = pattern.slice(0, wildcardIndex + "://".length);
		const suffix = pattern.slice(wildcardIndex + "://*".length);
		return (
			origin.startsWith(scheme) &&
			origin.endsWith(suffix) &&
			origin.length > scheme.length + suffix.length
		);
	});
}

/**
 * The gateway is a server-to-server API authenticated with a bearer API key, so
 * it sends no CORS headers by default. Browser-based clients that need direct
 * access are opted in per deployment through `GATEWAY_CORS_ORIGINS`; when that
 * variable is unset or empty the middleware is a no-op and every cross-origin
 * browser request stays blocked.
 *
 * Credentials are deliberately not allowed: requests carry the API key in the
 * `Authorization` header, never in cookies.
 */
export const corsMiddleware: MiddlewareHandler = async (c, next) => {
	const allowedOrigins = parseAllowedOrigins(process.env.GATEWAY_CORS_ORIGINS);
	if (allowedOrigins.length === 0) {
		return await next();
	}

	return await cors({
		origin: (origin) =>
			isAllowedOrigin(allowedOrigins, origin) ? origin : null,
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"Cache-Control",
			"x-api-key",
			"mcp-session-id",
			"x-no-cache",
			"x-no-fallback",
			"x-session-id",
			"x-session-affinity",
			"session_id",
			"session-id",
		],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "PATCH", "DELETE"],
		exposeHeaders: ["Content-Length", "mcp-session-id", "x-llmgateway-cache"],
		maxAge: 600,
	})(c, next);
};
