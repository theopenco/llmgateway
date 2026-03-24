import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
import { validateSource } from "@/chat/tools/validate-source.js";
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

const moderationRequestSchema = z.object({
	input: z.any().openapi({
		description: "Input text or multimodal content to classify.",
		example: "I want to harm someone.",
	}),
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
					schema: z.any(),
				},
			},
			description: "Moderation response.",
		},
	},
});

moderations.openapi(createModeration, async (c): Promise<any> => {
	const requestId = c.req.header("x-request-id") ?? shortid(40);
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

	if (apiKey.usageLimit && Number(apiKey.usage) >= Number(apiKey.usageLimit)) {
		throw new HTTPException(401, {
			message: "Unauthorized: LLMGateway API key reached its usage limit.",
		});
	}

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

	const retentionLevel = organization.retentionLevel ?? "none";

	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;

	if (project.mode === "api-keys") {
		providerKey = await findProviderKey(project.organizationId, "openai");
		if (!providerKey) {
			throw new HTTPException(400, {
				message:
					"No API key set for provider: openai. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.",
			});
		}
		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		usedToken = getProviderEnv("openai").token;
	} else if (project.mode === "hybrid") {
		providerKey = await findProviderKey(project.organizationId, "openai");
		usedToken = providerKey?.token ?? getProviderEnv("openai").token;
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
				...getProviderHeaders("openai", usedToken),
			},
			body: JSON.stringify(requestBody),
			signal: fetchSignal,
		});

		upstreamText = await upstreamResponse.text();
		duration = Date.now() - startedAt;
		responseSize = upstreamText.length;
	} catch (error) {
		duration = Date.now() - startedAt;
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
			upstreamResponse.status as any,
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
