import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
import { validateSource } from "@/chat/tools/validate-source.js";
import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";
import { assertApiKeyWithinUsageLimits } from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";
import type { InferSelectModel, tables } from "@llmgateway/db";

const moderationInputTextSchema = z.string().openapi({
	description: "Plain text input to classify.",
	example: "I want to harm someone.",
});

const moderationInputContentSchema = z
	.object({
		type: z.enum(["text", "image_url"]).openapi({
			description: "Input item type.",
			example: "text",
		}),
		text: z.string().optional().openapi({
			description: "Text content for `type: text` items.",
			example: "Please review this sentence.",
		}),
		image_url: z
			.object({
				url: z.string().openapi({
					description: "Image URL or data URL for `type: image_url` items.",
					example: "https://example.com/image.png",
				}),
			})
			.optional()
			.openapi({
				description: "Image payload for `type: image_url` items.",
			}),
	})
	.openapi({
		description: "Multimodal moderation input item.",
	});

const moderationInputSchema = z
	.union([
		moderationInputTextSchema,
		z.array(moderationInputTextSchema),
		z.array(moderationInputContentSchema),
	])
	.openapi({
		description:
			"Plain text, an array of text strings, or an array of multimodal input items.",
		example: "I want to harm someone.",
	});

const moderationResultSchema = z
	.object({
		flagged: z.boolean().openapi({
			description: "Whether the input was flagged.",
			example: true,
		}),
		categories: z
			.record(z.boolean())
			.optional()
			.openapi({
				description: "Category flags returned by the moderation model.",
				example: {
					violence: true,
					self_harm: false,
				},
			}),
		category_scores: z
			.record(z.number())
			.optional()
			.openapi({
				description: "Model confidence scores for each category.",
				example: {
					violence: 0.98,
					self_harm: 0.01,
				},
			}),
		category_applied_input_types: z
			.record(z.array(z.string()))
			.optional()
			.openapi({
				description: "Input types that contributed to each category decision.",
			}),
	})
	.passthrough()
	.openapi({
		description: "One moderation result entry.",
	});

const moderationResponseSchema = z
	.object({
		id: z.string().optional().openapi({
			description: "Moderation response ID.",
			example: "modr-123",
		}),
		model: z.string().optional().openapi({
			description: "Moderation model used for the request.",
			example: "omni-moderation-latest",
		}),
		results: z.array(moderationResultSchema).optional().openapi({
			description: "Moderation results for the submitted input.",
		}),
	})
	.passthrough()
	.openapi({
		description: "Moderation response payload.",
	});

const moderationErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

const moderationRequestSchema = z.object({
	input: moderationInputSchema,
	model: z.string().optional().default("omni-moderation-latest").openapi({
		description: "OpenAI moderation model. Defaults to omni-moderation-latest.",
		example: "omni-moderation-latest",
	}),
});

function normalizeModerationInputToMessages(input: unknown) {
	if (Array.isArray(input)) {
		return input.map((item) => ({
			role: "user" as const,
			content: item,
		}));
	}

	return [
		{
			role: "user" as const,
			content: input,
		},
	];
}

function getResponseContent(responseJson: unknown): string | null {
	if (responseJson === null || responseJson === undefined) {
		return null;
	}

	return JSON.stringify(responseJson);
}

function getErrorFinishReason(status: number): string {
	return status >= 500 ? "upstream_error" : "client_error";
}

export const moderations = new OpenAPIHono<ServerTypes>();

const createModeration = createRoute({
	operationId: "v1_moderations",
	summary: "Moderations",
	description: "Classify text or multimodal inputs with OpenAI moderation.",
	method: "post",
	path: "/",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: moderationRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: moderationResponseSchema,
				},
			},
			description: "Moderation response.",
		},
		400: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Invalid request body or parameters.",
		},
		401: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Unauthorized request.",
		},
		403: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Forbidden upstream response.",
		},
		404: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Not found upstream response.",
		},
		410: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Archived or unavailable project.",
		},
		429: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Rate limited upstream response.",
		},
		500: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Internal server error.",
		},
		502: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Failed to connect to the upstream provider.",
		},
		503: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Service unavailable upstream response.",
		},
		504: {
			content: {
				"application/json": {
					schema: moderationErrorSchema,
				},
			},
			description: "Upstream provider timeout.",
		},
	},
});

moderations.openapi(createModeration, async (c): Promise<any> => {
	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);
	c.header("x-request-id", requestId);

	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return c.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
					param: null,
					code: "invalid_json",
				},
			},
			400,
		);
	}

	const validationResult = moderationRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		return c.json(
			{
				error: {
					message: "Invalid request parameters",
					type: "invalid_request_error",
					param: null,
					code: "invalid_parameters",
				},
			},
			400,
		);
	}

	const { input, model: upstreamModel } = validationResult.data;
	const startedAt = Date.now();
	const source = validateSource(
		c.req.header("x-source"),
		c.req.header("HTTP-Referer"),
	);
	const userAgent = c.req.header("User-Agent") ?? undefined;
	const debugMode =
		c.req.header("x-debug") === "true" ||
		process.env.FORCE_DEBUG_MODE === "true" ||
		process.env.NODE_ENV !== "production";
	const customHeaders = extractCustomHeaders(c);
	const normalizedMessages = normalizeModerationInputToMessages(input);

	const token = extractApiToken(c);
	const apiKey = await findApiKeyByToken(token);

	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. Please make sure the token is not deleted or disabled. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	assertApiKeyWithinUsageLimits(apiKey);

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	if (project.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(500, {
			message: "Could not find organization",
		});
	}

	if (organization.status === "deleted") {
		throw new HTTPException(410, {
			message: "Organization has been disabled and is no longer accessible",
		});
	}

	const retentionLevel = organization.retentionLevel ?? "none";

	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;

	if (project.mode === "api-keys") {
		providerKey = await findProviderKey(
			project.organizationId,
			"openai",
			requestId,
		);
		if (!providerKey) {
			throw new HTTPException(400, {
				message:
					"No API key set for provider: openai. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.",
			});
		}
		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		const envResult = getProviderEnv("openai");
		usedToken = envResult.token;
		configIndex = envResult.configIndex;
		envVarName = envResult.envVarName;
	} else if (project.mode === "hybrid") {
		providerKey = await findProviderKey(
			project.organizationId,
			"openai",
			requestId,
		);
		if (providerKey) {
			usedToken = providerKey.token;
		} else {
			const envResult = getProviderEnv("openai");
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		}
	} else {
		throw new HTTPException(400, {
			message: `Invalid project mode: ${project.mode}`,
		});
	}

	if (!usedToken) {
		throw new HTTPException(500, {
			message: "No token",
		});
	}

	const upstreamUrl = `${providerKey?.baseUrl ?? "https://api.openai.com"}/v1/moderations`;
	const requestBody = {
		input,
		model: upstreamModel,
	};

	const baseLogEntry = createLogEntry({
		requestId,
		project,
		apiKey,
		providerKeyId: providerKey?.id,
		usedModel: "openai-moderation",
		usedModelMapping: upstreamModel,
		usedProvider: "openai",
		requestedModel: "openai-moderation",
		requestedProvider: "openai",
		messages: normalizedMessages,
		source,
		customHeaders,
		debugMode,
		userAgent,
		rawRequest: rawBody,
		upstreamRequest: requestBody,
	});

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	let upstreamResponse: Response;
	let upstreamText: string;
	let duration: number;
	let responseSize: number;

	try {
		const fetchSignal = createCombinedSignal(controller);
		upstreamResponse = await fetch(upstreamUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...getProviderHeaders("openai", usedToken, { requestId }),
			},
			body: JSON.stringify(requestBody),
			signal: fetchSignal,
		});

		upstreamText = await upstreamResponse.text();
		duration = Date.now() - startedAt;
		responseSize = upstreamText.length;
	} catch (error) {
		duration = Date.now() - startedAt;
		if (envVarName !== undefined) {
			reportKeyError(envVarName, configIndex, 0);
		}
		if (providerKey?.id) {
			reportTrackedKeyError(providerKey.id, 0);
		}

		const isCanceled = error instanceof Error && error.name === "AbortError";
		const isTimeout = isTimeoutError(error);

		await insertLog({
			...baseLogEntry,
			duration,
			timeToFirstToken: null,
			timeToFirstReasoningToken: null,
			responseSize: 0,
			content: null,
			reasoningContent: null,
			finishReason: isCanceled ? "canceled" : "upstream_error",
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
			hasError: !isCanceled,
			streamed: false,
			canceled: isCanceled,
			errorDetails: isCanceled
				? null
				: {
						statusCode: 0,
						statusText: error instanceof Error ? error.name : "FetchError",
						responseText:
							error instanceof Error ? error.message : String(error),
					},
			inputCost: 0,
			outputCost: 0,
			cachedInputCost: 0,
			requestCost: 0,
			webSearchCost: 0,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			cost: 0,
			estimatedCost: false,
			discount: null,
			pricingTier: null,
			dataStorageCost: calculateDataStorageCost(
				null,
				null,
				null,
				null,
				retentionLevel,
			),
			cached: false,
			toolResults: null,
		});

		if (isCanceled) {
			return c.json(
				{
					error: {
						message: "Request canceled by client",
						type: "canceled",
						param: null,
						code: "request_canceled",
					},
				},
				400,
			);
		}

		return c.json(
			{
				error: {
					message: isTimeout
						? `Upstream provider timeout: ${
								error instanceof Error ? error.message : String(error)
							}`
						: `Failed to connect to provider: ${
								error instanceof Error ? error.message : String(error)
							}`,
					type: isTimeout ? "upstream_timeout" : "upstream_error",
					param: null,
					code: isTimeout ? "timeout" : "fetch_failed",
				},
			},
			isTimeout ? 504 : 502,
		);
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}

	let upstreamJson: unknown = null;
	if (upstreamText) {
		try {
			upstreamJson = JSON.parse(upstreamText);
		} catch {
			upstreamJson = upstreamText;
		}
	}

	if (!upstreamResponse.ok) {
		if (envVarName !== undefined) {
			reportKeyError(
				envVarName,
				configIndex,
				upstreamResponse.status,
				upstreamText,
			);
		}
		if (providerKey?.id) {
			reportTrackedKeyError(
				providerKey.id,
				upstreamResponse.status,
				upstreamText,
			);
		}

		await insertLog({
			...baseLogEntry,
			duration,
			timeToFirstToken: null,
			timeToFirstReasoningToken: null,
			responseSize,
			content: getResponseContent(upstreamJson),
			reasoningContent: null,
			finishReason: getErrorFinishReason(upstreamResponse.status),
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
			hasError: true,
			streamed: false,
			canceled: false,
			errorDetails: {
				statusCode: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
				responseText: upstreamText,
			},
			inputCost: 0,
			outputCost: 0,
			cachedInputCost: 0,
			requestCost: 0,
			webSearchCost: 0,
			imageInputTokens: null,
			imageOutputTokens: null,
			imageInputCost: null,
			imageOutputCost: null,
			cost: 0,
			estimatedCost: false,
			discount: null,
			pricingTier: null,
			dataStorageCost: calculateDataStorageCost(
				null,
				null,
				null,
				null,
				retentionLevel,
			),
			cached: false,
			toolResults: null,
		});

		return c.json(
			(typeof upstreamJson === "string"
				? { error: { message: upstreamJson } }
				: upstreamJson) ?? { error: true },
			upstreamResponse.status as
				| 400
				| 401
				| 403
				| 404
				| 410
				| 429
				| 500
				| 502
				| 503
				| 504,
		);
	}

	if (envVarName !== undefined) {
		reportKeySuccess(envVarName, configIndex);
	}
	if (providerKey?.id) {
		reportTrackedKeySuccess(providerKey.id);
	}

	await insertLog({
		...baseLogEntry,
		duration,
		timeToFirstToken: null,
		timeToFirstReasoningToken: null,
		responseSize,
		content: getResponseContent(upstreamJson),
		reasoningContent: null,
		finishReason: "stop",
		promptTokens: null,
		completionTokens: null,
		totalTokens: null,
		reasoningTokens: null,
		cachedTokens: null,
		hasError: false,
		streamed: false,
		canceled: false,
		errorDetails: null,
		inputCost: 0,
		outputCost: 0,
		cachedInputCost: 0,
		requestCost: 0,
		webSearchCost: 0,
		imageInputTokens: null,
		imageOutputTokens: null,
		imageInputCost: null,
		imageOutputCost: null,
		cost: 0,
		estimatedCost: false,
		discount: null,
		pricingTier: null,
		dataStorageCost: calculateDataStorageCost(
			null,
			null,
			null,
			null,
			retentionLevel,
		),
		cached: false,
		toolResults: null,
	});

	return c.json(upstreamJson as any);
});
