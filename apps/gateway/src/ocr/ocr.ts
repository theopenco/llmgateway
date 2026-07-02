import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { buildRoutingAttempt } from "@/chat/tools/build-routing-attempt.js";
import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getFinishReasonFromError } from "@/chat/tools/get-finish-reason-from-error.js";
import { getProviderEnv } from "@/chat/tools/get-provider-env.js";
import {
	getErrorType,
	isRetryableErrorType,
	shouldRetryAlternateKey,
} from "@/chat/tools/retry-with-fallback.js";
import { validateSource } from "@/chat/tools/validate-source.js";
import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";
import {
	assertApiKeyWithinUsageLimits,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import { assertProviderCompliant } from "@/lib/compliance.js";
import {
	applyEndUserSession,
	assertTestWalletModelAllowed,
} from "@/lib/end-user-session.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvValue,
	models as modelDefinitions,
} from "@llmgateway/models";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

// Mistral accepts either a document URL/PDF or an image. The image_url variant
// may be a bare string or an object with a `url` field, mirroring the upstream
// API. Extra fields are passed through so newer document options keep working.
const ocrDocumentSchema = z
	.union([
		z
			.object({
				type: z.literal("document_url"),
				document_url: z.string().openapi({
					description: "URL or data URL of the PDF/document to process.",
					example: "https://arxiv.org/pdf/2201.04234",
				}),
				document_name: z.string().optional(),
			})
			.passthrough(),
		z
			.object({
				type: z.literal("image_url"),
				image_url: z
					.union([z.string(), z.object({ url: z.string() }).passthrough()])
					.openapi({
						description:
							"URL or data URL of the image to process, or an object with a `url` field.",
					}),
			})
			.passthrough(),
	])
	.openapi({
		description: "The document or image to run OCR on.",
	});

const ocrRequestSchema = z
	.object({
		model: z.string().openapi({
			description: "ID of the OCR model to use.",
			example: "mistral-ocr-latest",
		}),
		document: ocrDocumentSchema,
		id: z.string().optional(),
		pages: z
			.union([z.array(z.number().int()), z.string()])
			.optional()
			.openapi({
				description:
					"Specific pages to process, as a list of page indices or a range string (e.g. '0-5').",
			}),
		include_image_base64: z.boolean().optional().openapi({
			description:
				"Whether to return extracted images as base64 in the response.",
		}),
		image_limit: z.number().int().optional(),
		image_min_size: z.number().int().optional(),
		bbox_annotation_format: z.record(z.unknown()).optional(),
		document_annotation_format: z.record(z.unknown()).optional(),
	})
	.passthrough();

const ocrPageSchema = z
	.object({
		index: z.number().int().optional(),
		markdown: z.string().optional(),
		images: z.array(z.record(z.unknown())).optional(),
		dimensions: z.record(z.unknown()).nullable().optional(),
	})
	.passthrough();

const ocrUsageInfoSchema = z
	.object({
		pages_processed: z.number().int().optional(),
		doc_size_bytes: z.number().int().nullable().optional(),
	})
	.passthrough();

const ocrResponseSchema = z
	.object({
		pages: z.array(ocrPageSchema).optional(),
		model: z.string().optional(),
		document_annotation: z.string().nullable().optional(),
		usage_info: ocrUsageInfoSchema.optional(),
	})
	.passthrough()
	.openapi({
		description: "OCR response payload returned by the upstream provider.",
	});

const ocrErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

type OcrRequest = z.infer<typeof ocrRequestSchema>;

function previewDocument(document: OcrRequest["document"]): string {
	if (document.type === "document_url") {
		return `[document_url: ${document.document_url}]`;
	}
	const url =
		typeof document.image_url === "string"
			? document.image_url
			: document.image_url.url;
	const preview = url.startsWith("data:") ? "[inline image]" : url;
	return `[image_url: ${preview}]`;
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
	if ("model" in value) {
		summary.model = value.model;
	}
	if ("usage_info" in value) {
		summary.usage_info = value.usage_info;
	}
	if (Array.isArray(value.pages)) {
		summary.page_count = value.pages.length;
	}
	return JSON.stringify(summary);
}

function findOcrMapping(modelId: string): {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
	explicitProvider: boolean;
} | null {
	// Split an optional "<provider>/<model>" prefix so callers can pin a
	// provider explicitly. OCR currently resolves to a single provider, but the
	// shape mirrors the embeddings/speech endpoints for consistency.
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
			if (!candidate.ocr) {
				continue;
			}
			if (requestedProvider && candidate.providerId !== requestedProvider) {
				continue;
			}
			if (model.id === modelKey) {
				return {
					mapping: candidate,
					modelDef: model,
					modelDefId: model.id,
					explicitProvider: requestedProvider !== undefined,
				};
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
	const chatPlanCreditsRemaining =
		organization.chatPlan !== "none"
			? parseFloat(organization.chatPlanCreditsLimit ?? "0") -
				parseFloat(organization.chatPlanCreditsUsed ?? "0")
			: 0;

	return {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits:
			regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining,
	};
}

function assertCreditsAvailableForOcr(
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
	devPlanCreditLimitMessage: (renewalDate: string) => string,
) {
	const {
		devPlanCreditsRemaining,
		chatPlanCreditsRemaining,
		totalAvailableCredits,
	} = getAvailableCredits(organization);

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

	if (organization.chatPlan !== "none" && chatPlanCreditsRemaining <= 0) {
		const renewalDate = organization.chatPlanExpiresAt
			? new Date(organization.chatPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: `Chat Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		});
	}

	throw new HTTPException(402, { message: insufficientCreditsMessage });
}

export const ocr = new OpenAPIHono<ServerTypes>();

const createOcr = createRoute({
	operationId: "v1_ocr",
	summary: "OCR",
	description:
		"Extract text and structure from a document or image as markdown using an OCR model.",
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
					schema: ocrRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: ocrResponseSchema,
				},
			},
			description: "OCR response.",
		},
		400: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Invalid request body or parameters.",
		},
		401: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Unauthorized request.",
		},
		402: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Payment required / insufficient credits.",
		},
		403: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Forbidden upstream response.",
		},
		404: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Not found upstream response.",
		},
		410: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Archived or unavailable project.",
		},
		429: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Rate limited upstream response.",
		},
		500: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Internal server error.",
		},
		502: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Failed to connect to the upstream provider.",
		},
		503: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Service unavailable upstream response.",
		},
		504: {
			content: { "application/json": { schema: ocrErrorSchema } },
			description: "Upstream provider timeout.",
		},
	},
});

ocr.openapi(createOcr, async (c): Promise<any> => {
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

	const validationResult = ocrRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		return c.json(
			{
				error: {
					message: `Invalid request parameters: ${validationResult.error.issues
						.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
						.join(", ")}`,
					type: "invalid_request_error",
					param: null,
					code: "invalid_parameters",
				},
			},
			400,
		);
	}

	const { model: requestedModel, ...ocrParams } = validationResult.data;

	const match = findOcrMapping(requestedModel);
	if (!match) {
		return c.json(
			{
				error: {
					message: `OCR model not found: ${requestedModel}`,
					type: "invalid_request_error",
					param: "model",
					code: "model_not_found",
				},
			},
			400,
		);
	}

	const { mapping, modelDef, modelDefId, explicitProvider } = match;
	const upstreamModel = mapping.externalId;
	const providerId = mapping.providerId;

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
	const normalizedMessages = [
		{ role: "user" as const, content: previewDocument(ocrParams.document) },
	];

	const token = extractApiToken(c);
	const apiKey = await findApiKeyByToken(token);

	if (!apiKey) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. The token could not be found. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: This LLMGateway API token is not active (it may be disabled or deleted). Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	assertApiKeyWithinUsageLimits(apiKey);

	const baseProject = await findProjectById(apiKey.projectId);
	if (!baseProject) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	if (baseProject.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	// Enforce the per-member budget set on the Teams page (fails open on read
	// errors). Uses the key creator + resolved org.
	await assertMemberWithinBudget(apiKey.createdBy, baseProject.organizationId);

	const baseOrganization = await findOrganizationById(
		baseProject.organizationId,
	);
	if (!baseOrganization) {
		throw new HTTPException(500, {
			message: "Could not find organization",
		});
	}

	if (baseOrganization.status === "deleted") {
		throw new HTTPException(410, {
			message: "Organization has been disabled and is no longer accessible",
		});
	}

	// LLM SDK: ephemeral end-user sessions bill the bound wallet instead of the
	// developer's org credits. For normal keys this is a no-op.
	const { project, organization, wallet } = await applyEndUserSession(
		c,
		apiKey,
		baseProject,
		baseOrganization,
	);

	// Sandbox wallets can only spend on free models (none for OCR today), so this
	// rejects paid OCR requests from test-mode end-user sessions.
	assertTestWalletModelAllowed(wallet, modelDef);

	if (organization.kind === "devpass" && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"OCR is not available for coding plans. Coding plans only include text-based inference.",
		});
	}

	const retentionLevel = organization.retentionLevel ?? "none";
	const iamValidation = await validateRequestModelAccess(
		apiKey,
		modelDefId,
		providerId,
		modelDef,
		getClientIpFromRequest(c),
	);
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}

	// Enterprise provider compliance policy: OCR resolves to a single provider,
	// so block the request before any data is sent if that provider doesn't meet
	// the org's required certifications/data policies.
	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: modelDefId,
		apiKeyId: apiKey.id,
		model: requestedModel,
	});

	const finalLogId = shortid();
	const failedKeys = createFailedKeyTracker();

	const selectionReason = explicitProvider
		? "direct-provider-specified"
		: "single-provider-available";
	const routingAttempts: RoutingAttempt[] = [];
	const buildOcrRoutingMetadata = (
		usedApiKeyHash: string | undefined,
	): RoutingMetadata => ({
		availableProviders: [providerId],
		selectedProvider: providerId,
		selectionReason,
		...(usedApiKeyHash ? { usedApiKeyHash } : {}),
		providerScores: [],
		...(routingAttempts.length > 0 ? { routing: routingAttempts } : {}),
	});

	const retryProject = {
		mode: project.mode,
		organizationId: project.organizationId,
	};
	const retryOrganization = organization;

	const upstreamRequestBody: Record<string, unknown> = {
		...ocrParams,
		model: upstreamModel,
	};

	interface OcrAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
	}

	async function resolveAttempt(): Promise<OcrAttempt> {
		let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		let usedToken: string | undefined;
		let configIndex = 0;
		let envVarName: string | undefined;

		const excludedProviderKeyIds = failedKeys.providerKeyIdsFor(
			providerId,
			undefined,
		);
		const excludedEnvKeyIndices = failedKeys.envKeyIndicesFor(
			providerId,
			undefined,
		);

		if (retryProject.mode === "api-keys") {
			providerKey = await findProviderKey(
				retryProject.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (!providerKey) {
				throw new HTTPException(400, {
					message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
				});
			}
			usedToken = providerKey.token;
		} else if (retryProject.mode === "credits") {
			assertCreditsAvailableForOcr(
				retryOrganization,
				modelDef,
				`Organization ${retryOrganization.id} has insufficient credits`,
				(renewalDate) =>
					`Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
			);

			const envResult = getProviderEnv(providerId, {
				selectionScope: upstreamModel,
				excludedIndices: excludedEnvKeyIndices,
			});
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		} else if (retryProject.mode === "hybrid") {
			providerKey = await findProviderKey(
				retryProject.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (providerKey) {
				usedToken = providerKey.token;
			} else {
				assertCreditsAvailableForOcr(
					retryOrganization,
					modelDef,
					"No API key set for provider and organization has insufficient credits",
					(renewalDate) =>
						`No API key set for provider. Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
				);

				const envResult = getProviderEnv(providerId, {
					selectionScope: upstreamModel,
					excludedIndices: excludedEnvKeyIndices,
				});
				usedToken = envResult.token;
				configIndex = envResult.configIndex;
				envVarName = envResult.envVarName;
			}
		} else {
			throw new HTTPException(400, {
				message: `Invalid project mode: ${retryProject.mode}`,
			});
		}

		if (retentionLevel === "retain") {
			const { totalAvailableCredits } = getAvailableCredits(retryOrganization);
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

		const envBaseUrl = getProviderEnvValue(providerId, "baseUrl", configIndex);
		const resolvedBaseUrl =
			providerKey?.baseUrl ?? envBaseUrl ?? "https://api.mistral.ai";

		return {
			providerKey,
			usedToken,
			configIndex,
			envVarName,
			upstreamUrl: `${resolvedBaseUrl}/v1/ocr`,
		};
	}

	async function resolveNextAttempt(
		failedAttempt: OcrAttempt,
	): Promise<OcrAttempt | null> {
		failedKeys.remember(providerId, undefined, {
			envVarName: failedAttempt.envVarName,
			configIndex: failedAttempt.configIndex,
			providerKeyId: failedAttempt.providerKey?.id,
		});
		try {
			const next = await resolveAttempt();
			if (
				next.usedToken === failedAttempt.usedToken &&
				next.envVarName === failedAttempt.envVarName &&
				next.configIndex === failedAttempt.configIndex &&
				next.providerKey?.id === failedAttempt.providerKey?.id
			) {
				return null;
			}
			return next;
		} catch {
			return null;
		}
	}

	let attempt: OcrAttempt = await resolveAttempt();

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	try {
		while (true) {
			const attemptLogId = shortid();
			const usedApiKeyHash = getApiKeyFingerprint(attempt.usedToken);
			const baseLogEntry = createLogEntry({
				requestId,
				project,
				apiKey,
				providerKeyId: attempt.providerKey?.id,
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
				upstreamRequest: upstreamRequestBody,
			});

			let upstreamResponse: Response;
			let fetchError: Error | null = null;
			try {
				const fetchSignal = createCombinedSignal(controller);
				upstreamResponse = await fetch(attempt.upstreamUrl, {
					method: "POST",
					// SSRF: never follow redirects on an authenticated provider request. A
					// tenant-supplied baseUrl could 3xx to an internal host at request
					// time, and a redirect would also leak the upstream token.
					redirect: "error",
					headers: {
						"Content-Type": "application/json",
						...getProviderHeaders(providerId, attempt.usedToken, { requestId }),
					},
					body: JSON.stringify(upstreamRequestBody),
					signal: fetchSignal,
				});
			} catch (error) {
				const isCanceled =
					error instanceof Error && error.name === "AbortError";
				const isTimeout = isTimeoutError(error);
				const isNetworkError = error instanceof TypeError;
				if (!isCanceled && !isTimeout && !isNetworkError) {
					throw error;
				}
				fetchError = error instanceof Error ? error : new Error(String(error));
				upstreamResponse = undefined as unknown as Response;
			}

			if (fetchError !== null) {
				const isCanceled = fetchError.name === "AbortError";
				const isTimeout = isTimeoutError(fetchError);
				const duration = Date.now() - startedAt;

				if (!isCanceled) {
					if (attempt.envVarName !== undefined) {
						reportKeyError(
							attempt.envVarName,
							attempt.configIndex,
							0,
							undefined,
							upstreamModel,
						);
					}
					if (attempt.providerKey?.id) {
						reportTrackedKeyError(
							attempt.providerKey.id,
							0,
							undefined,
							upstreamModel,
						);
					}
				}

				const networkErrorType = isTimeout
					? "upstream_timeout"
					: "network_error";
				const nextAttempt =
					!isCanceled && isRetryableErrorType(networkErrorType)
						? await resolveNextAttempt(attempt)
						: null;
				const willRetry = nextAttempt !== null;

				if (!isCanceled) {
					routingAttempts.push(
						buildRoutingAttempt(
							providerId,
							modelDefId,
							0,
							networkErrorType,
							false,
							{
								apiKeyHash: usedApiKeyHash,
								logId: willRetry ? attemptLogId : finalLogId,
							},
						),
					);
				}

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildOcrRoutingMetadata(usedApiKeyHash),
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
								statusText: fetchError.name,
								responseText: fetchError.message,
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
					retried: willRetry,
					retriedByLogId: willRetry ? finalLogId : null,
				});

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

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
								? `Upstream provider timeout: ${fetchError.message}`
								: `Failed to connect to provider: ${fetchError.message}`,
							type: isTimeout ? "upstream_timeout" : "upstream_error",
							param: null,
							code: isTimeout ? "timeout" : "fetch_failed",
						},
					},
					isTimeout ? 504 : 502,
				);
			}

			const upstreamText = await upstreamResponse.text();
			const duration = Date.now() - startedAt;
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
				const status = upstreamResponse.status;
				if (attempt.envVarName !== undefined) {
					reportKeyError(
						attempt.envVarName,
						attempt.configIndex,
						status,
						upstreamText,
						upstreamModel,
					);
				}
				if (attempt.providerKey?.id) {
					reportTrackedKeyError(
						attempt.providerKey.id,
						status,
						upstreamText,
						upstreamModel,
					);
				}

				const finishReason = getFinishReasonFromError(status, upstreamText);
				const nextAttempt = shouldRetryAlternateKey(
					finishReason,
					status,
					upstreamText,
				)
					? await resolveNextAttempt(attempt)
					: null;
				const willRetry = nextAttempt !== null;

				routingAttempts.push(
					buildRoutingAttempt(
						providerId,
						modelDefId,
						status,
						getErrorType(status),
						false,
						{
							apiKeyHash: usedApiKeyHash,
							logId: willRetry ? attemptLogId : finalLogId,
						},
					),
				);

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildOcrRoutingMetadata(usedApiKeyHash),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize,
					content: getResponseContent(upstreamJson),
					reasoningContent: null,
					finishReason,
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: true,
					streamed: false,
					canceled: false,
					errorDetails: {
						statusCode: status,
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
					retried: willRetry,
					retriedByLogId: willRetry ? finalLogId : null,
				});

				if (willRetry && nextAttempt) {
					attempt = nextAttempt;
					continue;
				}

				const normalizedUpstreamError: z.infer<typeof ocrErrorSchema> = {
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
					status as 400 | 401 | 403 | 404 | 410 | 429 | 500 | 502 | 503 | 504,
				);
			}

			if (attempt.envVarName !== undefined) {
				reportKeySuccess(
					attempt.envVarName,
					attempt.configIndex,
					upstreamModel,
				);
			}
			if (attempt.providerKey?.id) {
				reportTrackedKeySuccess(attempt.providerKey.id, upstreamModel);
			}

			const usageInfo =
				upstreamJson &&
				typeof upstreamJson === "object" &&
				"usage_info" in (upstreamJson as Record<string, unknown>)
					? ((upstreamJson as Record<string, unknown>).usage_info as
							| Record<string, unknown>
							| undefined)
					: undefined;
			const pagesProcessedRaw = usageInfo?.pages_processed;
			const pagesProcessed =
				typeof pagesProcessedRaw === "number" ? pagesProcessedRaw : null;
			if (pagesProcessed === null) {
				logger.warn("OCR response missing usage_info.pages_processed", {
					requestId,
					provider: providerId,
					model: upstreamModel,
				});
			}

			const ocrPagePrice = Number(mapping.ocrPagePrice ?? "0");
			const requestCost = Number(mapping.requestPrice ?? "0");
			const pageCost =
				pagesProcessed !== null ? pagesProcessed * ocrPagePrice : 0;
			const cost = pageCost + requestCost;

			routingAttempts.push(
				buildRoutingAttempt(
					providerId,
					modelDefId,
					upstreamResponse.status,
					"none",
					true,
					{
						apiKeyHash: usedApiKeyHash,
						logId: finalLogId,
					},
				),
			);

			await insertLog({
				...baseLogEntry,
				id: finalLogId,
				routingMetadata: buildOcrRoutingMetadata(usedApiKeyHash),
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
				inputCost: pageCost,
				outputCost: 0,
				cachedInputCost: 0,
				requestCost,
				webSearchCost: 0,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				cost,
				estimatedCost: pagesProcessed === null,
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

			return c.json(upstreamJson as z.infer<typeof ocrResponseSchema>);
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
});
