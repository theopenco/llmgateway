import { HTTPException } from "hono/http-exception";

import type { Context } from "hono";

const MISSING_API_TOKEN_MESSAGE =
	"Unauthorized: No API key provided. Expected 'Authorization: Bearer your-api-token' header or 'x-api-key: your-api-token' header";

/**
 * Parses an API token from Authorization or x-api-key headers.
 */
export function parseApiToken(c: Pick<Context, "req">): string | null {
	const auth = c.req.header("Authorization");
	if (auth) {
		const split = auth.split("Bearer ");
		if (split.length === 2 && split[1]) {
			return split[1];
		}
	}

	const xApiKey = c.req.header("x-api-key");
	if (xApiKey) {
		return xApiKey;
	}

	return null;
}

/**
 * Extracts an API token from request headers or throws a 401 when missing.
 */
export function extractApiToken(c: Pick<Context, "req">): string {
	const token = parseApiToken(c);
	if (token) {
		return token;
	}

	throw new HTTPException(401, {
		message: MISSING_API_TOKEN_MESSAGE,
	});
}
