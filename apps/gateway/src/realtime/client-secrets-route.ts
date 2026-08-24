import { OpenAPIHono, z } from "@hono/zod-openapi";

import { validateSource } from "@/chat/tools/validate-source.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";

import { logger } from "@llmgateway/logger";
import { estimateTokensFromText } from "@llmgateway/shared";
import { getClientIpFromRequest } from "@llmgateway/shared/client-ip";

import { findRealtimeTranscriptionMapping } from "./catalog.js";
import {
	clampClientSecretTtl,
	createClientSecret,
	MAX_CLIENT_SECRET_INSTRUCTIONS_TOKENS,
} from "./client-secrets.js";
import { RealtimeConnectError } from "./errors.js";
import { runRealtimePreflight } from "./preflight.js";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const realtimeClientSecretsRoute = new OpenAPIHono<ServerTypes>();

export function isRealtimeEnabled(): boolean {
	// Kill switch, independent of how realtime is deployed.
	if (process.env.REALTIME_DISABLED === "true") {
		return false;
	}
	// Escape hatch for deployments that front /v1/realtime with something other
	// than this process.
	if (process.env.REALTIME_ENABLED !== undefined) {
		return process.env.REALTIME_ENABLED !== "false";
	}
	// Otherwise the only realtime backend this process can vouch for is its own
	// inline listener. Minting without one hands out secrets for a WebSocket
	// path that nothing serves.
	return process.env.REALTIME_INLINE === "true";
}

// Only the session fields this gateway actually honors are accepted; unknown
// fields are rejected (strict) rather than silently pretended to be applied.
const transcriptionSchema = z
	.object({
		model: z.string().min(1),
	})
	.strict();

const sessionAudioInputSchema = z
	.object({
		transcription: transcriptionSchema.nullable().optional(),
	})
	.strict();

const sessionAudioOutputSchema = z
	.object({
		voice: z.string().min(1).optional(),
	})
	.strict();

const sessionAudioSchema = z
	.object({
		input: sessionAudioInputSchema.optional(),
		output: sessionAudioOutputSchema.optional(),
	})
	.strict();

const clientSecretSessionSchema = z
	.object({
		type: z.literal("realtime"),
		model: z.string().min(1),
		// Locked for the session's lifetime once set; see instructions_locked in
		// session.ts.
		instructions: z.string().min(1).optional(),
		audio: sessionAudioSchema.optional(),
	})
	.strict();

const expiresAfterSchema = z
	.object({
		anchor: z.literal("created_at").optional(),
		seconds: z.number().int().optional(),
	})
	.strict();

const clientSecretRequestSchema = z
	.object({
		expires_after: expiresAfterSchema.optional(),
		session: clientSecretSessionSchema,
	})
	.strict();

function errorResponse(
	c: Context<ServerTypes>,
	status: number,
	code: string,
	message: string,
) {
	return c.json(
		{
			error: {
				message,
				type: "invalid_request_error",
				param: null,
				code,
			},
		},
		status as ContentfulStatusCode,
	);
}

/**
 * POST /v1/realtime/client_secrets — mint a short-lived ephemeral client
 * secret (ek_...) that browser clients can present via the
 * "openai-insecure-api-key.<secret>" WebSocket subprotocol to open a
 * /v1/realtime session without exposing a long-lived API key.
 * Authentication, plan, credit, model, IAM, and compliance checks run at
 * mint time; the WebSocket upgrade re-runs them and remains authoritative.
 */
realtimeClientSecretsRoute.post("/client_secrets", async (c) => {
	if (!isRealtimeEnabled()) {
		return errorResponse(
			c,
			503,
			"realtime_disabled",
			"Realtime sessions are not enabled on this deployment.",
		);
	}

	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return errorResponse(c, 400, "invalid_json", "Request body must be JSON.");
	}
	const parsed = clientSecretRequestSchema.safeParse(rawBody);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return errorResponse(
			c,
			400,
			"invalid_request",
			`Invalid client secret request: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "malformed body"}`,
		);
	}
	const body = parsed.data;

	const token = extractApiToken(c);
	const source =
		validateSource(c.req.header("x-source"), c.req.header("http-referer")) ??
		null;

	// Full preflight at mint time so deterministic failures (auth, plan,
	// credits, model, IAM, compliance) surface as normal HTTP errors before
	// any WebSocket attempt.
	let preflight;
	try {
		preflight = await runRealtimePreflight({
			token,
			requestedModel: body.session.model,
			clientIp: getClientIpFromRequest(c),
		});
	} catch (error) {
		if (error instanceof RealtimeConnectError) {
			return errorResponse(c, error.status, error.code, error.message);
		}
		throw error;
	}

	const requestedTranscription = body.session.audio?.input?.transcription;
	let transcriptionModel: string | null = null;
	if (requestedTranscription) {
		const match = findRealtimeTranscriptionMapping(
			requestedTranscription.model,
			preflight.match.mapping.providerId,
		);
		if (!match) {
			return errorResponse(
				c,
				400,
				"transcription_model_not_supported",
				`Transcription model not supported for realtime sessions: ${requestedTranscription.model}`,
			);
		}
		if (!preflight.allowedTranscriptionModelIds.includes(match.modelId)) {
			return errorResponse(
				c,
				403,
				"transcription_model_not_allowed",
				`This API key is not allowed to use the transcription model ${match.modelId}.`,
			);
		}
		transcriptionModel = formatUsedModelForDisplay(
			match.mapping.providerId,
			match.modelId,
			undefined,
			match.mapping.region,
		);
	}

	const instructions = body.session.instructions ?? null;
	if (instructions !== null) {
		const estimatedTokens = estimateTokensFromText(instructions);
		if (estimatedTokens > MAX_CLIENT_SECRET_INSTRUCTIONS_TOKENS) {
			return errorResponse(
				c,
				400,
				"instructions_too_large",
				`Session instructions are too large for a realtime session: roughly ${estimatedTokens} tokens, limit ${MAX_CLIENT_SECRET_INSTRUCTIONS_TOKENS}.`,
			);
		}
	}

	const voice = body.session.audio?.output?.voice ?? null;
	if (voice !== null) {
		const supportedVoices = preflight.match.mapping.supportedVoices ?? [];
		if (supportedVoices.length > 0 && !supportedVoices.includes(voice)) {
			return errorResponse(
				c,
				400,
				"voice_not_supported",
				`Unsupported voice '${voice}' for model ${preflight.match.modelId}. Supported voices: ${supportedVoices.join(", ")}.`,
			);
		}
	}

	const ttlSeconds = clampClientSecretTtl(body.expires_after?.seconds);
	const responseModel = formatUsedModelForDisplay(
		preflight.match.mapping.providerId,
		preflight.match.modelId,
		undefined,
		preflight.match.mapping.region,
	);

	let secret;
	try {
		secret = await createClientSecret({
			token,
			model: responseModel,
			transcriptionModel,
			instructions,
			voice,
			source,
			ttlSeconds,
		});
	} catch (error) {
		if (error instanceof RealtimeConnectError) {
			return errorResponse(c, error.status, error.code, error.message);
		}
		throw error;
	}

	logger.info("Realtime client secret minted", {
		organizationId: preflight.project.organizationId,
		model: preflight.match.modelId,
		ttlSeconds,
	});

	return c.json({
		value: secret.value,
		expires_at: secret.expiresAt,
		session: {
			type: "realtime" as const,
			model: responseModel,
		},
	});
});
