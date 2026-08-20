import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { buildRoutingAttempt } from "@/chat/tools/build-routing-attempt.js";
import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { getFinishReasonFromError } from "@/chat/tools/get-finish-reason-from-error.js";
import {
	getCredentialSetting,
	resolvePlatformCredential,
} from "@/chat/tools/resolve-platform-credential.js";
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
import { raceClientAbort } from "@/lib/client-abort.js";
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
import { formatUsedModelForDisplay } from "@/lib/model-response-id.js";
import { assertOrganizationUsable } from "@/lib/organization-access.js";
import { assertSpendLimit } from "@/lib/spend-limit.js";
import {
	clientFacingUpstreamFailureMessage,
	redactedProviderErrorText,
	shouldRedactProviderError,
} from "@/lib/stealth-provider-errors.js";
import { createCombinedSignal, isTimeoutError } from "@/lib/timeout-config.js";
import { validateModelOutput } from "@/lib/validate-model-output.js";

import {
	getProviderDefaultBaseUrl,
	getProviderHeaders,
	providerKeyLabel,
	readProviderKey,
} from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";
import {
	getOrganizationEnvVariant,
	models as modelDefinitions,
	type Provider,
} from "@llmgateway/models";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";
import type { RoutingCredentialSource } from "@llmgateway/shared/routing-telemetry";
import type { Context } from "hono";

const rerankRequestSchema = z.object({
	model: z.string().openapi({
		description: "ID of the rerank model to use.",
		example: "deepinfra/qwen3-reranker-8b",
	}),
	query: z.string().min(1).openapi({
		description: "The search query to rank documents against.",
		example: "What is the capital of France?",
	}),
	documents: z
		.array(z.string())
		.min(1)
		.openapi({
			description: "Array of document strings to rerank.",
			example: [
				"Paris is the capital of France.",
				"Berlin is the capital of Germany.",
				"Madrid is the capital of Spain.",
			],
		}),
	top_n: z.number().int().positive().optional().openapi({
		description:
			"Number of top results to return. Defaults to all documents when omitted.",
		example: 2,
	}),
	return_documents: z.boolean().optional().openapi({
		description:
			"Whether to include the document text in the response. Default false.",
		example: true,
	}),
	max_chunks_per_doc: z.number().int().positive().optional().openapi({
		description:
			"Maximum number of chunks per document (accepted, but not all providers support this).",
		example: 10,
	}),
});

const rerankResultSchema = z
	.object({
		index: z.number().int(),
		relevance_score: z.number(),
		document: z.string().optional(),
	})
	.passthrough();

const rerankBilledUnitsSchema = z
	.object({
		input_tokens: z.number().int().optional(),
		total_tokens: z.number().int().optional(),
	})
	.passthrough();

const rerankMetaSchema = z
	.object({
		api_version: z
			.object({
				version: z.string().optional(),
			})
			.optional(),
		billed_units: rerankBilledUnitsSchema.optional(),
	})
	.passthrough();

const rerankResponseSchema = z
	.object({
		id: z.string().optional(),
		model: z.string(),
		results: z.array(rerankResultSchema),
		meta: rerankMetaSchema.optional(),
	})
	.passthrough()
	.openapi({
		description: "Cohere-compatible rerank response payload.",
	});

const rerankErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

function findRerankMapping(modelId: string): {
	mapping: ProviderModelMapping;
	modelDef: ModelDefinition;
	modelDefId: string;
	explicitProvider: boolean;
} | null {
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
			if (!candidate.rerank) {
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

async function assertCreditsAvailableForRerank(
	c: Context,
	organization: InferSelectModel<typeof tables.organization>,
	modelDef: ModelDefinition,
	insufficientCreditsMessage: string,
	devPlanCreditLimitMessage: (renewalDate: string) => string,
) {
	await assertSpendLimit(c, organization, modelDef.free === true);

	const { totalAvailableCredits } = getAvailableCredits(organization);

	if (totalAvailableCredits > 0 || modelDef.free) {
		return;
	}

	if (organization.devPlan !== "none" && organization.devPlanCreditsLimit) {
		const remaining =
			parseFloat(organization.devPlanCreditsLimit ?? "0") -
			parseFloat(organization.devPlanCreditsUsed ?? "0");
		if (remaining <= 0) {
			const renewalDate = organization.devPlanExpiresAt
				? organization.devPlanExpiresAt.toISOString()
				: "unknown";
			throw new HTTPException(402, {
				message: devPlanCreditLimitMessage(renewalDate),
			});
		}
	}

	throw new HTTPException(402, { message: insufficientCreditsMessage });
}

export const rerank = new OpenAPIHono<ServerTypes>();

const createRerank = createRoute({
	operationId: "v1_rerank",
	summary: "Rerank",
	description:
		"Rerank documents against a query using a cross-encoder reranker. Cohere-compatible API.",
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
					schema: rerankRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: rerankResponseSchema,
				},
			},
			description: "Rerank response with ranked results.",
		},
		400: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Invalid request body or parameters.",
		},
		401: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Unauthorized request.",
		},
		402: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Payment required / Insufficient credits.",
		},
		403: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Forbidden upstream response.",
		},
		404: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Not found upstream response.",
		},
		410: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Archived or unavailable project.",
		},
		429: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Rate limited upstream response.",
		},
		500: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Internal server error.",
		},
		502: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Bad gateway / Upstream fetch failure.",
		},
		503: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Service unavailable.",
		},
		504: {
			content: {
				"application/json": {
					schema: rerankErrorSchema,
				},
			},
			description: "Gateway timeout.",
		},
	},
});

rerank.openapi(createRerank, async (c): Promise<any> => {
	const startedAt = Date.now();
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

	const validationResult = rerankRequestSchema.safeParse(rawBody);
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
		model: requestedModel,
		query,
		documents,
		top_n,
		return_documents,
		max_chunks_per_doc,
	} = validationResult.data;

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

	// 1. Extract API key → resolve org/project
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

	// Budget checks
	await assertMemberWithinBudget(apiKey.createdBy, baseProject.organizationId);
	assertApiKeyWithinUsageLimits(apiKey);

	const baseOrganization = await findOrganizationById(
		baseProject.organizationId,
	);
	if (!baseOrganization) {
		throw new HTTPException(500, {
			message: "Could not find organization",
		});
	}

	assertOrganizationUsable(baseOrganization);

	// LLM SDK: ephemeral end-user sessions
	const { project, organization, wallet } = await applyEndUserSession(
		c,
		apiKey,
		baseProject,
		baseOrganization,
	);

	const retentionLevel = organization.retentionLevel ?? "none";

	// 2. Resolve model → provider mapping
	const result = findRerankMapping(requestedModel);
	if (!result) {
		return c.json(
			{
				error: {
					message: `Model ${requestedModel} not found or is not a rerank model`,
					type: "invalid_request_error",
					param: null,
					code: "model_not_found",
				},
			},
			400,
		);
	}

	const {
		mapping: rerankMapping,
		modelDef,
		modelDefId,
		explicitProvider,
	} = result;
	const providerId = rerankMapping.providerId;
	const upstreamModel = rerankMapping.externalId;
	const responseModel = formatUsedModelForDisplay(
		providerId,
		modelDefId,
		undefined,
		rerankMapping.region,
	);

	// 3. Validate model output includes "rerank"
	validateModelOutput(modelDef, requestedModel, ["rerank"]);

	assertTestWalletModelAllowed(wallet, modelDef);

	if (organization.kind === "devpass" && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"Reranking is not available for coding plans. Coding plans only include text-based inference.",
		});
	}

	// 4. IAM
	const iamValidation = await validateRequestModelAccess({
		apiKey,
		organizationId: project.organizationId,
		requestedModel: modelDefId,
		requestedProvider: providerId,
		activeModelInfo: modelDef,
		clientIp: getClientIpFromRequest(c),
	});
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}

	// 5. Enterprise provider compliance
	await assertProviderCompliant(organization, providerId, {
		organizationId: project.organizationId,
		modelId: modelDefId,
		apiKeyId: apiKey.id,
		model: requestedModel,
	});

	const failedKeys = createFailedKeyTracker();
	const routingAttempts: RoutingAttempt[] = [];
	const finalLogId = shortid();

	const buildRerankRoutingMetadata = (
		usedApiKeyHash: string | undefined,
		usedCredentialSource: RoutingCredentialSource,
		usedProviderKey: { id?: string; label?: string },
	): RoutingMetadata => ({
		availableProviders: [providerId],
		selectedProvider: providerId,
		selectionReason: explicitProvider
			? "direct-provider-specified"
			: "single-provider-available",
		...(usedApiKeyHash
			? {
					usedApiKeyHash,
					usedCredentialSource,
					usedProviderKeyId: usedProviderKey.id,
					usedProviderKeyLabel: usedProviderKey.label,
				}
			: {}),
		providerScores: [],
		...(routingAttempts.length > 0 ? { routing: routingAttempts } : {}),
	});

	const isDeepInfra = providerId === "deepinfra";

	interface RerankAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		/** Platform-managed credential when one served this attempt. */
		managedKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
		requestBody: Record<string, unknown>;
	}

	type ResolveResult =
		| { kind: "ok"; attempt: RerankAttempt }
		| {
				kind: "json_error";
				status: 400 | 500;
				body: z.infer<typeof rerankErrorSchema>;
		  };

	async function resolveAttempt(): Promise<ResolveResult> {
		let providerKeyInner:
			InferSelectModel<typeof tables.providerKey> | undefined;
		let managedKeyInner:
			InferSelectModel<typeof tables.providerKey> | undefined;
		let usedToken: string | undefined;
		let configIndex = 0;
		let envVarName: string | undefined;
		const envVariant = getOrganizationEnvVariant(organization);

		const excludedProviderKeyIds = failedKeys.providerKeyIdsFor(
			providerId,
			undefined,
		);
		const excludedEnvKeyIndices = failedKeys.envKeyIndicesFor(
			providerId,
			undefined,
		);

		const resolveCredits = async () => {
			const platformCredential = await resolvePlatformCredential(
				providerId as Provider,
				{
					selectionScope: upstreamModel,
					variant: envVariant,
					region: undefined,
					requiresServiceTier: false,
					excludedEnvIndices: excludedEnvKeyIndices,
					excludedProviderKeyIds,
				},
			);
			managedKeyInner = platformCredential.managedKey;
			usedToken = platformCredential.token;
			configIndex = platformCredential.configIndex;
			envVarName = platformCredential.envVarName;
		};

		if (project.mode === "api-keys") {
			providerKeyInner = await findProviderKey(
				project.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (!providerKeyInner) {
				throw new HTTPException(400, {
					message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
				});
			}
			usedToken = readProviderKey(providerKeyInner);
		} else if (project.mode === "credits") {
			await assertCreditsAvailableForRerank(
				c,
				organization,
				modelDef,
				`Organization ${organization.id} has insufficient credits`,
				(renewalDate) =>
					`Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
			);

			await resolveCredits();
		} else if (project.mode === "hybrid") {
			providerKeyInner = await findProviderKey(
				project.organizationId,
				providerId,
				upstreamModel,
				excludedProviderKeyIds,
			);
			if (providerKeyInner) {
				usedToken = readProviderKey(providerKeyInner);
			} else {
				await assertCreditsAvailableForRerank(
					c,
					organization,
					modelDef,
					"No API key set for provider and organization has insufficient credits",
					(renewalDate) =>
						`No API key set for provider. Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
				);

				await resolveCredits();
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

		// Base URL of the platform credential serving the attempt: the managed
		// credential's own config when one is active, the provider's env var
		// otherwise. A BYOK key's base URL still wins when set.
		const envBaseUrl = getCredentialSetting(
			providerId as Provider,
			"baseUrl",
			managedKeyInner,
			{ configIndex, variant: envVariant },
		);
		const resolvedBaseUrl =
			providerKeyInner?.baseUrl ??
			envBaseUrl ??
			getProviderDefaultBaseUrl(providerId) ??
			"https://api.openai.com";

		let upstreamUrl: string;
		let requestBody: Record<string, unknown>;

		if (isDeepInfra) {
			// DeepInfra rerank uses the inference endpoint
			// (https://api.deepinfra.com/v1/inference/{externalId}), which is a
			// sibling of the OpenAI-compatible surface the base URL points at
			// (https://api.deepinfra.com/v1/openai). Drop that suffix so the path
			// doesn't double up to /v1/openai/v1/inference and 404.
			const inferenceBaseUrl = resolvedBaseUrl.replace(/\/v1\/openai\/?$/, "");
			upstreamUrl = `${inferenceBaseUrl}/v1/inference/${upstreamModel}`;
			requestBody = {
				queries: [query],
				documents,
			};
		} else {
			// Generic provider: assume a Cohere-compatible rerank endpoint
			upstreamUrl = `${resolvedBaseUrl}/v1/rerank`;
			requestBody = {
				model: upstreamModel,
				query,
				documents,
				...(top_n !== undefined ? { top_n } : {}),
			};
		}

		if (return_documents !== undefined) {
			requestBody.return_documents = return_documents;
		}
		if (max_chunks_per_doc !== undefined) {
			requestBody.max_chunks_per_doc = max_chunks_per_doc;
		}

		return {
			kind: "ok",
			attempt: {
				providerKey: providerKeyInner,
				managedKey: managedKeyInner,
				usedToken,
				configIndex,
				envVarName,
				upstreamUrl,
				requestBody,
			},
		};
	}

	async function resolveNextAttempt(
		failedAttempt: RerankAttempt,
	): Promise<RerankAttempt | null> {
		failedKeys.remember(providerId, undefined, {
			envVarName: failedAttempt.envVarName,
			configIndex: failedAttempt.configIndex,
			providerKeyId:
				failedAttempt.providerKey?.id ?? failedAttempt.managedKey?.id,
		});
		try {
			const next = await resolveAttempt();
			if (next.kind !== "ok") {
				return null;
			}
			if (
				next.attempt.usedToken === failedAttempt.usedToken &&
				next.attempt.envVarName === failedAttempt.envVarName &&
				next.attempt.configIndex === failedAttempt.configIndex &&
				next.attempt.providerKey?.id === failedAttempt.providerKey?.id &&
				next.attempt.managedKey?.id === failedAttempt.managedKey?.id
			) {
				return null;
			}
			return next.attempt;
		} catch {
			return null;
		}
	}

	const initialResult = await resolveAttempt();
	if (initialResult.kind === "json_error") {
		return c.json(initialResult.body, initialResult.status);
	}
	let attempt: RerankAttempt = initialResult.attempt;

	const controller = new AbortController();
	const onAbort = () => {
		controller.abort();
	};
	c.req.raw.signal.addEventListener("abort", onAbort);

	try {
		while (true) {
			const attemptLogId = shortid();
			const usedApiKeyHash = getApiKeyFingerprint(attempt.usedToken);
			// BYOK only when the organization's own key served the attempt; a
			// platform-managed credential is LLM Gateway's key and bills as credits.
			const credentialSource: RoutingCredentialSource = attempt.providerKey
				? "byok"
				: "platform";
			// Named only for the organization's own key; providerKeyLabel()
			// refuses to describe a platform-managed credential.
			const providerKeyId = attempt.providerKey?.id;
			const keyLabel = providerKeyLabel(attempt.providerKey);
			const usedProviderKey = { id: providerKeyId, label: keyLabel };
			const baseLogEntry = createLogEntry({
				requestId,
				project,
				apiKey,
				organizationProviderKeyId: attempt.providerKey?.id,
				usedProviderKeyId: attempt.providerKey?.id ?? attempt.managedKey?.id,
				usedModel: `${providerId}/${modelDefId}`,
				usedModelMapping: upstreamModel,
				usedProvider: providerId,
				requestedModel,
				requestedProvider: providerId,
				messages: [
					{
						role: "user",
						content: `query: ${query}\ndocuments: ${documents.slice(0, 5).join(", ")}${documents.length > 5 ? `... and ${documents.length - 5} more` : ""}`,
					},
				],
				source,
				apiOrigin: "rerank",
				customHeaders,
				debugMode,
				userAgent,
				rawRequest: rawBody,
				upstreamRequest: attempt.requestBody,
			});

			let upstreamResponse: Response;
			let upstreamText = "";
			let fetchError: Error | null = null;
			try {
				const fetchSignal = createCombinedSignal(controller);
				upstreamResponse = await fetch(attempt.upstreamUrl, {
					method: "POST",
					redirect: "error",
					headers: {
						"Content-Type": "application/json",
						...getProviderHeaders(providerId, attempt.usedToken, {
							requestId,
						}),
					},
					body: JSON.stringify(attempt.requestBody),
					signal: fetchSignal,
				});
				upstreamText = await raceClientAbort(
					upstreamResponse.text(),
					c.req.raw.signal,
					controller,
				);
			} catch (error) {
				const isCanceled =
					error instanceof Error &&
					(error.name === "AbortError" || c.req.raw.signal.aborted);
				const isTimeout = isTimeoutError(error);
				const isNetworkError = error instanceof TypeError;
				if (!isCanceled && !isTimeout && !isNetworkError) {
					throw error;
				}
				fetchError = error instanceof Error ? error : new Error(String(error));
				upstreamResponse = undefined as unknown as Response;
			}

			if (fetchError !== null) {
				const isCanceled =
					fetchError.name === "AbortError" || c.req.raw.signal.aborted;
				const isTimeout = isTimeoutError(fetchError);

				const duration = Date.now() - startedAt;
				if (attempt.envVarName !== undefined) {
					reportKeyError(
						attempt.envVarName,
						attempt.configIndex,
						0,
						undefined,
						upstreamModel,
					);
				}
				const failedTrackedKeyId =
					attempt.providerKey?.id ?? attempt.managedKey?.id;
				if (failedTrackedKeyId) {
					reportTrackedKeyError(
						failedTrackedKeyId,
						0,
						undefined,
						upstreamModel,
					);
				}

				const networkErrorType = isTimeout
					? "upstream_timeout"
					: "network_error";
				const nextAttempt: RerankAttempt | null =
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
								credentialSource,
								providerKeyId,
								providerKeyLabel: keyLabel,
								logId: willRetry ? attemptLogId : finalLogId,
							},
						),
					);
				}

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildRerankRoutingMetadata(
						usedApiKeyHash,
						credentialSource,
						usedProviderKey,
					),
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
							message: clientFacingUpstreamFailureMessage(
								providerId,
								isTimeout
									? "Upstream provider timeout"
									: "Failed to connect to provider",
								fetchError.message,
							),
							type: isTimeout ? "upstream_timeout" : "upstream_error",
							param: null,
							code: isTimeout ? "timeout" : "fetch_failed",
						},
					},
					isTimeout ? 504 : 502,
				);
			}

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
				const failedTrackedKeyId =
					attempt.providerKey?.id ?? attempt.managedKey?.id;
				if (failedTrackedKeyId) {
					reportTrackedKeyError(
						failedTrackedKeyId,
						status,
						upstreamText,
						upstreamModel,
					);
				}

				const finishReason = getFinishReasonFromError(status, upstreamText);
				const nextAttempt: RerankAttempt | null = shouldRetryAlternateKey(
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
							credentialSource,
							providerKeyId,
							providerKeyLabel: keyLabel,
							logId: willRetry ? attemptLogId : finalLogId,
						},
					),
				);

				await insertLog({
					...baseLogEntry,
					id: willRetry ? attemptLogId : finalLogId,
					routingMetadata: buildRerankRoutingMetadata(
						usedApiKeyHash,
						credentialSource,
						usedProviderKey,
					),
					duration,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize,
					content: null,
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

				// Stealth providers: never pass the raw upstream error body through
				// to the client — only the upstream status code may be surfaced.
				if (shouldRedactProviderError(providerId)) {
					return c.json(
						{
							error: {
								message: redactedProviderErrorText(status),
								type: "upstream_error",
								param: null,
								code: "upstream_error",
							},
						},
						status as 400 | 401 | 403 | 404 | 410 | 429 | 500 | 502 | 503 | 504,
					);
				}

				const normalizedUpstreamError: Record<string, unknown> = {
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
			const trackedKeyHealthId =
				attempt.providerKey?.id ?? attempt.managedKey?.id;
			if (trackedKeyHealthId) {
				reportTrackedKeySuccess(trackedKeyHealthId, upstreamModel);
			}

			// Translate response from DeepInfra → Cohere format
			let normalizedResponse: Record<string, unknown>;
			let promptTokens: number | null = null;
			let totalTokens: number | null = null;

			if (isDeepInfra) {
				const upstream =
					upstreamJson && typeof upstreamJson === "object"
						? (upstreamJson as Record<string, unknown>)
						: {};

				const scores = Array.isArray(upstream.scores)
					? (upstream.scores as number[])
					: [];
				const inputTokens =
					typeof upstream.input_tokens === "number"
						? (upstream.input_tokens as number)
						: null;

				let results = scores.map((score, index) => ({
					index,
					relevance_score: score,
					...(return_documents ? { document: documents[index] } : {}),
				}));

				results.sort((a, b) => b.relevance_score - a.relevance_score);
				if (top_n !== undefined && top_n < results.length) {
					results = results.slice(0, top_n);
				}

				promptTokens = inputTokens;
				totalTokens = inputTokens;

				normalizedResponse = {
					id: requestId,
					results,
					meta: {
						api_version: { version: "1" },
						billed_units: {
							input_tokens: inputTokens ?? 0,
							total_tokens: inputTokens ?? 0,
						},
					},
				};
			} else {
				// Generic Cohere-compatible rerank
				normalizedResponse = (upstreamJson ?? {}) as Record<string, unknown>;
				if (!normalizedResponse.id) {
					normalizedResponse.id = requestId;
				}
			}
			normalizedResponse.model = responseModel;

			// Calculate cost from input tokens
			const inputPrice = Number(rerankMapping.inputPrice ?? "0");
			const inputCost = promptTokens !== null ? inputPrice * promptTokens : 0;
			const requestCostNum = Number(rerankMapping.requestPrice ?? "0");
			const cost = inputCost + requestCostNum;

			routingAttempts.push(
				buildRoutingAttempt(
					providerId,
					modelDefId,
					upstreamResponse.status,
					"none",
					true,
					{
						apiKeyHash: usedApiKeyHash,
						credentialSource,
						providerKeyId,
						providerKeyLabel: keyLabel,
						logId: finalLogId,
					},
				),
			);

			await insertLog({
				...baseLogEntry,
				id: finalLogId,
				routingMetadata: buildRerankRoutingMetadata(
					usedApiKeyHash,
					credentialSource,
					usedProviderKey,
				),
				duration,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize,
				content: JSON.stringify(normalizedResponse).slice(0, 1000),
				reasoningContent: null,
				finishReason: null,
				promptTokens: totalTokens !== null ? totalTokens.toString() : null,
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
				requestCost: requestCostNum,
				webSearchCost: 0,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				cost,
				estimatedCost: promptTokens === null,
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
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
});
