import { z } from "@hono/zod-openapi";

/**
 * OpenAI-compatible error envelope produced by `renderGatewayError` for every
 * endpoint except `/v1/messages` (see `lib/error-response.ts`).
 */
export const openAIErrorSchema = z
	.object({
		error: z.object({
			message: z.string(),
			type: z.string(),
			param: z.string().nullable(),
			code: z.string().nullable(),
		}),
	})
	.openapi("OpenAIError", { description: "OpenAI-compatible error object." });

/** Anthropic-compatible error envelope returned by `/v1/messages`. */
export const anthropicErrorSchema = z
	.object({
		type: z.literal("error"),
		error: z.object({
			type: z.string(),
			message: z.string(),
		}),
	})
	.openapi("AnthropicError", {
		description: "Anthropic-compatible error object.",
	});

// Plain OpenAPI header objects (not zod) so declaring them does not tighten
// the route's typed handler signature.
export const rateLimitHeaders = {
	"RateLimit-Policy": {
		schema: { type: "string" } as const,
		description:
			'Quota policy as an HTTP Structured Fields list, e.g. "requests";q=60;w=60.',
	},
	RateLimit: {
		schema: { type: "string" } as const,
		description: 'Available quota and reset delay, e.g. "requests";r=59;t=60.',
	},
	"RateLimit-Limit": {
		schema: { type: "string" } as const,
		description: "Request limit for the current window.",
	},
	"RateLimit-Remaining": {
		schema: { type: "string" } as const,
		description: "Requests remaining in the current window.",
	},
	"RateLimit-Reset": {
		schema: { type: "string" } as const,
		description: "Seconds until the current window resets.",
	},
};

const retryHeaders = {
	...rateLimitHeaders,
	"Retry-After": {
		schema: { type: "string" } as const,
		description: "Seconds to wait before retrying.",
	},
};

type GatewayErrorSchema =
	typeof openAIErrorSchema | typeof anthropicErrorSchema;

function errorResponse(schema: GatewayErrorSchema, description: string) {
	return {
		content: { "application/json": { schema } },
		description,
	};
}

/**
 * The standard 4xx/5xx response set every gateway endpoint can produce, for
 * use in `createRoute({ responses: { 200: ..., ...standardErrorResponses() } })`.
 * Pass `anthropicErrorSchema` for `/v1/messages`.
 */
export function standardErrorResponses(
	schema: GatewayErrorSchema = openAIErrorSchema,
) {
	return {
		400: errorResponse(schema, "Invalid request body or parameters."),
		401: errorResponse(schema, "Missing or invalid API key."),
		402: errorResponse(schema, "Insufficient credits or plan limits reached."),
		403: errorResponse(schema, "Forbidden request or upstream response."),
		404: errorResponse(schema, "Unknown model or upstream not-found response."),
		408: errorResponse(schema, "Request timeout."),
		410: errorResponse(schema, "Archived or unavailable project."),
		413: errorResponse(schema, "Request too large."),
		415: errorResponse(schema, "Unsupported media type."),
		429: {
			content: { "application/json": { schema } },
			headers: retryHeaders,
			description:
				"Rate limited (organization, endpoint, or upstream provider). Back off until Retry-After elapses.",
		},
		500: errorResponse(schema, "Internal server error."),
		502: errorResponse(schema, "Failed to connect to the upstream provider."),
		503: errorResponse(schema, "Service unavailable upstream response."),
		504: errorResponse(schema, "Upstream provider timeout."),
		529: {
			...errorResponse(schema, "Gateway overloaded."),
			headers: { "Retry-After": retryHeaders["Retry-After"] },
		},
	};
}

/**
 * Error responses for unauthenticated public endpoints (no 401/402/410).
 */
export function publicErrorResponses(
	schema: GatewayErrorSchema = openAIErrorSchema,
) {
	return {
		429: {
			content: { "application/json": { schema } },
			headers: retryHeaders,
			description: "Rate limited. Back off until Retry-After elapses.",
		},
		500: errorResponse(schema, "Internal server error."),
		503: errorResponse(schema, "Service unavailable."),
	};
}
