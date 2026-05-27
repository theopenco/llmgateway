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
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { throwIamException, validateModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvValue,
	models as modelDefinitions,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

const embeddingInputSchema = z
	.union([
		z.string(),
		z.array(z.string()),
		z.array(z.number().int()),
		z.array(z.array(z.number().int())),
	])
	.openapi({
		description:
			"Input text to embed. A single string, an array of strings, an array of token IDs, or an array of token-ID arrays. Cannot exceed the model's max input tokens (8192 for OpenAI text-embedding-3 and ada-002).",
		example: "The food was delicious and the waiter was friendly.",
	});

const embeddingRequestSchema = z.object({
	input: embeddingInputSchema,
	model: z.string().openapi({
		description: "ID of the embedding model to use.",
		example: "text-embedding-3-small",
	}),
	encoding_format: z.enum(["float", "base64"]).optional().openapi({
		description:
			"Format of the returned embeddings. `float` returns plain arrays, `base64` returns a packed base64 string.",
		example: "float",
	}),
	dimensions: z.number().int().positive().optional().openapi({
		description:
			"Number of dimensions for the output embeddings. Only supported on `text-embedding-3-*` models.",
		example: 1536,
	}),
	user: z.string().optional().openapi({
		description:
			"Stable end-user identifier forwarded to OpenAI for abuse monitoring.",
	}),
});

const embeddingObjectSchema = z
	.object({
		object: z.literal("embedding"),
		embedding: z.union([z.array(z.number()), z.string()]),
		index: z.number().int(),
	})
	.passthrough();

const embeddingUsageSchema = z
	.object({
		prompt_tokens: z.number().int(),
		total_tokens: z.number().int(),
	})
	.passthrough();

const embeddingResponseSchema = z
	.object({
		object: z.literal("list").optional(),
		data: z.array(embeddingObjectSchema).optional(),
		model: z.string().optional(),
		usage: embeddingUsageSchema.optional(),
	})
	.passthrough()
	.openapi({
		description: "OpenAI-compatible embeddings response payload.",
	});

const embeddingErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

function normalizeEmbeddingInputToMessages(input: unknown) {
	const previewItem = (item: unknown) => {
		if (typeof item === "string") {
			return item;
		}
		if (Array.isArray(item)) {
			return `[token ids: length=${item.length}]`;
		}
		return JSON.stringify(item ?? null);
	};

	if (Array.isArray(input)) {
		if (input.every((item) => typeof item === "number")) {
			return [
				{
					role: "user" as const,
					content: `[token ids: length=${input.length}]`,
				},
			];
		}

		return input.map((item) => ({
			role: "user" as const,
			content: previewItem(item),
		}));
	}

	return [
		{
			role: "user" as const,
			content: previewItem(input),
		},
	];
}

function getResponseContent(responseJson: unknown): string | null {
	if (responseJson === null || responseJson === undefined) {
		return null;
	}

	if (typeof responseJson !== "object") {
		return JSON.stringify(responseJson);
	}

	const value = responseJson as Record<string, unknown>;
	const summary: Record<string, unknown> = {};
	if ("object" in value) {
		summary.object = value.object;
	}
	if ("model" in value) {
		summary.model = value.model;
	}
	if ("usage" in value) {
		summary.usage = value.usage;
	}
	if (Array.isArray(value.data)) {
		summary.data_count = value.data.length;
		const first = value.data[0];
		if (first && typeof first === "object") {
			const firstEmbedding = (first as Record<string, unknown>).embedding;
			if (Array.isArray(firstEmbedding)) {
				summary.embedding_dimensions = firstEmbedding.length;
			} else if (typeof firstEmbedding === "string") {
				summary.embedding_dimensions = "base64";
			}
		}
	}
	return JSON.stringify(summary);
}

function getErrorFinishReason(status: number): string {
	return status >= 500 ? "upstream_error" : "client_error";
}

function packFloat32Base64(values: number[]): string {
	const buffer = new ArrayBuffer(values.length * 4);
	const view = new DataView(buffer);
	for (let i = 0; i < values.length; i++) {
		view.setFloat32(i * 4, values[i], true);
	}
	return Buffer.from(buffer).toString("base64");
}

function findEmbeddingMapping(modelId: string): {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
} | null {
	// Split an optional "<provider>/<model>" prefix. When present, only
	// mappings on that provider are considered — this lets callers pick
	// e.g. google-vertex/gemini-embedding-001 explicitly when the same
	// model id also exists on google-ai-studio.
	let requestedProvider: string | undefined;
	let modelKey = modelId;
	const slashIdx = modelId.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = modelId.slice(0, slashIdx);
		modelKey = modelId.slice(slashIdx + 1);
	}
	for (const model of modelDefinitions) {
		for (const mapping of model.providers) {
			const candidate = mapping as ProviderModelMapping;
			if (!candidate.embeddings) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			if (model.id === modelKey || candidate.modelName === modelKey) {
				return { mapping: candidate, modelDef: model, modelDefId: model.id };
			}
		}
	}
	return null;
}

function getAvailableCredits(
	organization: InferSelectModel<typeof tables.organization>,
) {
	const regularCredits = parseFloat(organization.credits ?? "0");
	const devPlanCreditsRemaining =
		organization.devPlan !== "none"
			? parseFloat(organization.devPlanCreditsLimit ?? "0") -
				parseFloat(organization.devPlanCreditsUsed ?? "0")
			: 0;

	return {
		devPlanCreditsRemaining,
		totalAvailableCredits: regularCredits + devPlanCreditsRemaining,
	};
}

function assertCreditsAvailableForEmbedding(
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
	devPlanCreditLimitMessage: (renewalDate: string) => string,
) {
	const { devPlanCreditsRemaining, totalAvailableCredits } =
		getAvailableCredits(organization);

	if (totalAvailableCredits > 0 || modelDef.free) {
		return;
	}

	if (organization.devPlan !== "none" && devPlanCreditsRemaining <= 0) {
		const renewalDate = organization.devPlanExpiresAt
			? new Date(organization.devPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: devPlanCreditLimitMessage(renewalDate),
		});
	}

	throw new HTTPException(402, { message: insufficientCreditsMessage });
}

export const embeddings = new OpenAPIHono<ServerTypes>();

const createEmbeddings = createRoute({
	operationId: "v1_embeddings",
	summary: "Embeddings",
	description:
		"Generate vector embeddings for one or more inputs using an OpenAI-compatible embeddings model.",
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
					schema: embeddingRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: embeddingResponseSchema,
				},
			},
			description: "Embeddings response.",
		},
		400: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Invalid request body or parameters.",
		},
		401: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Unauthorized request.",
		},
		402: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Payment required / Insufficient credits or retention.",
		},
		403: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Forbidden upstream response.",
		},
		404: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Not found upstream response.",
		},
		410: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Archived or unavailable project.",
		},
		429: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Rate limited upstream response.",
		},
		500: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Internal server error.",
		},
		502: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Failed to connect to the upstream provider.",
		},
		503: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Service unavailable upstream response.",
		},
		504: {
			content: {
				"application/json": {
					schema: embeddingErrorSchema,
				},
			},
			description: "Upstream provider timeout.",
		},
	},
});

embeddings.openapi(createEmbeddings, async (c): Promise<any> => {
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

	const validationResult = embeddingRequestSchema.safeParse(rawBody);
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

	const {
		input,
		model: requestedModel,
		encoding_format,
		dimensions,
		user,
	} = validationResult.data;

	const match = findEmbeddingMapping(requestedModel);
	if (!match) {
		return c.json(
			{
				error: {
					message: `Embedding model not found: ${requestedModel}`,
					type: "invalid_request_error",
					param: "model",
					code: "model_not_found",
				},
			},
			400,
		);
	}

	const { mapping, modelDef, modelDefId } = match;
	const upstreamModel = mapping.modelName;
	const providerId = mapping.providerId;

	const isTokenIdInput = (() => {
		if (!Array.isArray(input)) {
			return false;
		}
		if (input.every((item) => typeof item === "number")) {
			return true;
		}
		return input.some(
			(item) => Array.isArray(item) && item.every((n) => typeof n === "number"),
		);
	})();

	if (
		isTokenIdInput &&
		(providerId === "google-ai-studio" || providerId === "google-vertex")
	) {
		return c.json(
			{
				error: {
					message: `Provider ${providerId} does not support token-ID inputs for embeddings. Pass a string or array of strings instead.`,
					type: "invalid_request_error",
					param: "input",
					code: "unsupported_input",
				},
			},
			400,
		);
	}
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
	const normalizedMessages = normalizeEmbeddingInputToMessages(input);

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

	if (organization.isPersonal && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"Embeddings are not available for coding plans. Coding plans only include text-based inference.",
		});
	}

	const retentionLevel = organization.retentionLevel ?? "none";
	const iamValidation = await validateModelAccess(
		apiKey.id,
		modelDefId,
		providerId,
		modelDef,
		getClientIpFromRequest(c),
	);
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}

	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;

	if (project.mode === "api-keys") {
		providerKey = await findProviderKey(
			project.organizationId,
			providerId,
			upstreamModel,
		);
		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
			});
		}
		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		assertCreditsAvailableForEmbedding(
			organization,
			modelDef,
			`Organization ${organization.id} has insufficient credits`,
			(renewalDate) =>
				`Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		);

		const envResult = getProviderEnv(providerId, {
			selectionScope: upstreamModel,
		});
		usedToken = envResult.token;
		configIndex = envResult.configIndex;
		envVarName = envResult.envVarName;
	} else if (project.mode === "hybrid") {
		providerKey = await findProviderKey(
			project.organizationId,
			providerId,
			upstreamModel,
		);
		if (providerKey) {
			usedToken = providerKey.token;
		} else {
			assertCreditsAvailableForEmbedding(
				organization,
				modelDef,
				"No API key set for provider and organization has insufficient credits",
				(renewalDate) =>
					`No API key set for provider. Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
			);

			const envResult = getProviderEnv(providerId, {
				selectionScope: upstreamModel,
			});
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		}
	} else {
		throw new HTTPException(400, {
			message: `Invalid project mode: ${project.mode}`,
		});
	}

	if (retentionLevel === "retain") {
		const { totalAvailableCredits } = getAvailableCredits(organization);

		if (totalAvailableCredits <= 0) {
			throw new HTTPException(402, {
				message:
					"Organization has insufficient credits for data retention. Data retention requires credits for storage costs ($0.01 per 1M tokens). Please add credits or disable data retention in organization settings.",
			});
		}
	}

	if (!usedToken) {
		throw new HTTPException(500, {
			message: "No token",
		});
	}

	const providerBaseUrlDefaults: Partial<Record<string, string>> = {
		openai: "https://api.openai.com",
		"google-ai-studio": "https://generativelanguage.googleapis.com",
		"google-vertex": "https://aiplatform.googleapis.com",
	};
	// Env baseUrl override: LLM_<PROVIDER>_BASE_URL can redirect upstream
	// traffic to proxies, regional endpoints, or test mocks. Applies to
	// any provider — getProviderEnvValue returns undefined for providers
	// that don't declare a baseUrl env in packages/models/src/providers.ts,
	// so the ?? chain falls through safely. providerKey.baseUrl still wins
	// when set, so BYOK callers can opt out by configuring their own.
	const envBaseUrl = getProviderEnvValue(providerId, "baseUrl", configIndex);
	const resolvedBaseUrl =
		providerKey?.baseUrl ??
		envBaseUrl ??
		providerBaseUrlDefaults[providerId] ??
		"https://api.openai.com";

	const isGoogleAiStudio = providerId === "google-ai-studio";
	const isGoogleVertex = providerId === "google-vertex";
	const googleInputs: string[] =
		isGoogleAiStudio || isGoogleVertex
			? Array.isArray(input)
				? (input as string[])
				: [input as string]
			: [];

	let upstreamUrl: string;
	let requestBody: Record<string, unknown>;

	if (isGoogleAiStudio) {
		const endpoint =
			googleInputs.length > 1 ? "batchEmbedContents" : "embedContent";
		upstreamUrl = `${resolvedBaseUrl}/v1beta/models/${upstreamModel}:${endpoint}?key=${encodeURIComponent(usedToken)}`;
		const buildSingleRequest = (text: string) => {
			const single: Record<string, unknown> = {
				content: { parts: [{ text }] },
			};
			if (dimensions !== undefined) {
				single.outputDimensionality = dimensions;
			}
			return single;
		};

		if (endpoint === "batchEmbedContents") {
			requestBody = {
				requests: googleInputs.map((text) => ({
					model: `models/${upstreamModel}`,
					...buildSingleRequest(text),
				})),
			};
		} else {
			requestBody = buildSingleRequest(googleInputs[0]);
		}
	} else if (isGoogleVertex) {
		// All exposed google-vertex embedding models go through PredictionService's
		// :predict endpoint, which accepts API-key auth via ?key= just like the
		// chat path. The text-embedding-* family natively batches up to 250
		// inputs per request; gemini-embedding-001 is the one model that only
		// accepts a single input per call, so we reject batches for it upfront
		// rather than fanning out silently (which would hide cost/quota/latency).
		const singleInputOnlyModels = new Set(["gemini-embedding-001"]);
		if (singleInputOnlyModels.has(upstreamModel) && googleInputs.length > 1) {
			return c.json(
				{
					error: {
						message: `Model ${upstreamModel} accepts only one input per request on google-vertex. Pass a single string instead of an array, loop client-side, or use the same model via the google-ai-studio provider which supports native batching via batchEmbedContents.`,
						type: "invalid_request_error",
						param: "input",
						code: "batch_not_supported",
					},
				},
				400,
			);
		}
		const vertexProjectId =
			providerKey?.options?.google_vertex_project_id ??
			getProviderEnvValue("google-vertex", "project", configIndex);
		if (!vertexProjectId) {
			return c.json(
				{
					error: {
						message:
							"Google Vertex requires a project ID. Set LLM_GOOGLE_CLOUD_PROJECT or configure google_vertex_project_id on the provider key.",
						type: "invalid_request_error",
						param: null,
						code: "missing_project_id",
					},
				},
				500,
			);
		}
		const vertexRegion =
			getProviderEnvValue("google-vertex", "region", configIndex, "global") ??
			"global";

		upstreamUrl = `${resolvedBaseUrl}/v1/projects/${vertexProjectId}/locations/${vertexRegion}/publishers/google/models/${upstreamModel}:predict?key=${encodeURIComponent(usedToken)}`;
		requestBody = {
			instances: googleInputs.map((text) => ({ content: text })),
		};
		if (dimensions !== undefined) {
			requestBody.parameters = { outputDimensionality: dimensions };
		}
	} else {
		upstreamUrl = `${resolvedBaseUrl}/v1/embeddings`;
		requestBody = {
			input,
			model: upstreamModel,
		};
		if (encoding_format !== undefined) {
			requestBody.encoding_format = encoding_format;
		}
		if (dimensions !== undefined) {
			requestBody.dimensions = dimensions;
		}
		if (user !== undefined) {
			requestBody.user = user;
		}
	}

	const baseLogEntry = createLogEntry({
		requestId,
		project,
		apiKey,
		providerKeyId: providerKey?.id,
		usedModel: `${providerId}/${modelDefId}`,
		usedModelMapping: upstreamModel,
		usedProvider: providerId,
		requestedModel,
		requestedProvider: providerId,
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
	let duration: number;

	try {
		const fetchSignal = createCombinedSignal(controller);
		upstreamResponse = await fetch(upstreamUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...getProviderHeaders(providerId, usedToken, { requestId }),
			},
			body: JSON.stringify(requestBody),
			signal: fetchSignal,
		});
	} catch (error) {
		const isCanceled = error instanceof Error && error.name === "AbortError";
		const isTimeout = isTimeoutError(error);
		const isNetworkError = error instanceof TypeError;

		if (!isCanceled && !isTimeout && !isNetworkError) {
			throw error;
		}

		duration = Date.now() - startedAt;
		if (envVarName !== undefined) {
			reportKeyError(envVarName, configIndex, 0);
		}
		if (providerKey?.id) {
			reportTrackedKeyError(providerKey.id, 0);
		}

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

	const upstreamText = await upstreamResponse.text();
	duration = Date.now() - startedAt;
	const responseSize = upstreamText.length;

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

		const normalizedUpstreamError: z.infer<typeof embeddingErrorSchema> = {
			error: {
				message:
					typeof upstreamJson === "string"
						? upstreamJson
						: (upstreamResponse.statusText ?? "Upstream error"),
				type: "upstream_error",
				param: null,
				code: "upstream_error",
			},
		};

		return c.json(
			upstreamJson && typeof upstreamJson === "object"
				? upstreamJson
				: normalizedUpstreamError,
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

	let normalizedResponse: Record<string, unknown> = (upstreamJson ??
		{}) as Record<string, unknown>;
	let promptTokens: number | null = null;
	let totalTokens: number | null = null;
	let estimatedUsage = false;

	if (isGoogleAiStudio) {
		const upstream =
			upstreamJson && typeof upstreamJson === "object"
				? (upstreamJson as Record<string, unknown>)
				: {};
		const rawEmbeddings: Array<Record<string, unknown>> = (() => {
			if (Array.isArray(upstream.embeddings)) {
				return upstream.embeddings as Array<Record<string, unknown>>;
			}
			if (upstream.embedding && typeof upstream.embedding === "object") {
				return [upstream.embedding as Record<string, unknown>];
			}
			return [];
		})();
		const wantsBase64 = encoding_format === "base64";
		const data = rawEmbeddings.map((item, index) => {
			const values = Array.isArray(item.values)
				? (item.values as number[])
				: [];
			return {
				object: "embedding" as const,
				index,
				embedding: wantsBase64 ? packFloat32Base64(values) : values,
			};
		});
		const upstreamUsage =
			upstream.usageMetadata && typeof upstream.usageMetadata === "object"
				? (upstream.usageMetadata as Record<string, unknown>)
				: undefined;
		const upstreamPromptTokens =
			typeof upstreamUsage?.promptTokenCount === "number"
				? upstreamUsage.promptTokenCount
				: null;
		const estimatedTokens = googleInputs.reduce(
			(sum, text) => sum + Math.max(1, Math.ceil(text.length / 4)),
			0,
		);
		if (upstreamPromptTokens !== null) {
			promptTokens = upstreamPromptTokens;
		} else {
			promptTokens = estimatedTokens;
			estimatedUsage = true;
		}
		totalTokens = promptTokens;
		normalizedResponse = {
			object: "list",
			data,
			model: requestedModel,
			usage: {
				prompt_tokens: promptTokens,
				total_tokens: totalTokens,
			},
		};
	} else if (isGoogleVertex) {
		const upstream =
			upstreamJson && typeof upstreamJson === "object"
				? (upstreamJson as Record<string, unknown>)
				: {};
		// Vertex :predict response: { predictions: [{embeddings: {values, statistics: {token_count}}}, ...] }
		// One prediction per instance. text-embedding-* models return multiple
		// when batched; gemini-embedding-001 always returns one.
		const predictions = Array.isArray(upstream.predictions)
			? (upstream.predictions as Array<Record<string, unknown>>)
			: [];
		const wantsBase64 = encoding_format === "base64";
		let upstreamTokenSum = 0;
		let anyTokenStatMissing = false;
		const data = predictions.map((prediction, index) => {
			const embeddingsObj =
				prediction.embeddings && typeof prediction.embeddings === "object"
					? (prediction.embeddings as Record<string, unknown>)
					: {};
			const values = Array.isArray(embeddingsObj.values)
				? (embeddingsObj.values as number[])
				: [];
			const stats =
				embeddingsObj.statistics && typeof embeddingsObj.statistics === "object"
					? (embeddingsObj.statistics as Record<string, unknown>)
					: undefined;
			if (typeof stats?.token_count === "number") {
				upstreamTokenSum += stats.token_count;
			} else {
				anyTokenStatMissing = true;
			}
			return {
				object: "embedding" as const,
				index,
				embedding: wantsBase64 ? packFloat32Base64(values) : values,
			};
		});
		if (predictions.length === 0 || anyTokenStatMissing) {
			promptTokens = googleInputs.reduce(
				(sum, text) => sum + Math.max(1, Math.ceil(text.length / 4)),
				0,
			);
			estimatedUsage = true;
		} else {
			promptTokens = upstreamTokenSum;
		}
		totalTokens = promptTokens;
		normalizedResponse = {
			object: "list",
			data,
			model: requestedModel,
			usage: {
				prompt_tokens: promptTokens,
				total_tokens: totalTokens,
			},
		};
	} else {
		const usage =
			upstreamJson &&
			typeof upstreamJson === "object" &&
			"usage" in (upstreamJson as Record<string, unknown>)
				? ((upstreamJson as Record<string, unknown>).usage as
						| Record<string, unknown>
						| undefined)
				: undefined;
		const promptTokensRaw = usage?.prompt_tokens;
		const totalTokensRaw = usage?.total_tokens;
		promptTokens = typeof promptTokensRaw === "number" ? promptTokensRaw : null;
		totalTokens =
			typeof totalTokensRaw === "number" ? totalTokensRaw : promptTokens;
		if (promptTokens === null) {
			logger.warn("Embeddings response missing usage.prompt_tokens", {
				requestId,
				provider: providerId,
				model: upstreamModel,
			});
		}
	}

	const inputPrice = Number(mapping.inputPrice ?? "0");
	const inputCost = promptTokens !== null ? promptTokens * inputPrice : 0;
	const requestCost = Number(mapping.requestPrice ?? "0");
	const cost = inputCost + requestCost;

	await insertLog({
		...baseLogEntry,
		duration,
		timeToFirstToken: null,
		timeToFirstReasoningToken: null,
		responseSize,
		content: getResponseContent(normalizedResponse),
		reasoningContent: null,
		finishReason: "stop",
		promptTokens: promptTokens !== null ? promptTokens.toString() : null,
		completionTokens: null,
		totalTokens: totalTokens !== null ? totalTokens.toString() : null,
		reasoningTokens: null,
		cachedTokens: null,
		hasError: false,
		streamed: false,
		canceled: false,
		errorDetails: null,
		inputCost,
		outputCost: 0,
		cachedInputCost: 0,
		requestCost,
		webSearchCost: 0,
		imageInputTokens: null,
		imageOutputTokens: null,
		imageInputCost: null,
		imageOutputCost: null,
		cost,
		estimatedCost: estimatedUsage,
		discount: null,
		pricingTier: null,
		dataStorageCost: calculateDataStorageCost(
			promptTokens,
			null,
			null,
			null,
			retentionLevel,
		),
		cached: false,
		toolResults: null,
	});

	return c.json(normalizedResponse);
});
