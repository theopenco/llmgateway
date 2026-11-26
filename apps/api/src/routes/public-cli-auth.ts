import { OpenAPIHono, z } from "@hono/zod-openapi";

import { redeemCliAuthCode } from "@/lib/cli-auth-code.js";
import { createRoute } from "@/utils/create-route.js";
import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { getClientIpFromContext } from "@llmgateway/shared/client-ip";

import type { ServerTypes } from "@/vars.js";

export const publicCliAuth = new OpenAPIHono<ServerTypes>();

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

const errorSchema = z.object({
	error: z.string(),
	error_description: z.string(),
});

const tokenRoute = createRoute({
	method: "post",
	path: "/token",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						code: z.string().min(1).max(128),
						code_verifier: z
							.string()
							.regex(/^[A-Za-z0-9._~-]{43,128}$/)
							.openapi({ description: "RFC 7636 PKCE code verifier." }),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						api_key: z.string(),
						expires_at: z.string().nullable(),
					}),
				},
			},
			description: "The API key the browser login created.",
		},
		400: {
			content: { "application/json": { schema: errorSchema } },
			description: "Unknown, expired, already used, or mismatched code.",
		},
		429: {
			content: { "application/json": { schema: errorSchema } },
			description: "Rate limit exceeded.",
		},
	},
});

/**
 * Redeems the one-time code a coding CLI's browser login receives on its
 * loopback callback. Unauthenticated: the PKCE verifier proves the caller
 * started the login.
 */
publicCliAuth.openapi(tokenRoute, async (c) => {
	const ip = getClientIpFromContext(c) ?? "unknown";
	if (
		!(await consumeRateLimit(
			`cli_auth_token_rate_limit:${ip}`,
			RATE_LIMIT_MAX,
			RATE_LIMIT_WINDOW_SECONDS,
		))
	) {
		return c.json(
			{
				error: "slow_down",
				error_description: "Too many requests. Please try again later.",
			},
			429,
		);
	}

	const { code, code_verifier } = c.req.valid("json");
	const redeemed = await redeemCliAuthCode(code, code_verifier);
	if (!redeemed) {
		return c.json(
			{
				error: "invalid_grant",
				error_description:
					"The login code is invalid, expired, or already used. Start the login again.",
			},
			400,
		);
	}

	return c.json(
		{ api_key: redeemed.token, expires_at: redeemed.expiresAt },
		200,
	);
});
