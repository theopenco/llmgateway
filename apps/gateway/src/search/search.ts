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
	assertMemberProjectAccess,
	assertMemberWithinBudget,
} from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
} from "@/lib/cached-queries.js";
import { raceClientAbort } from "@/lib/client-abort.js";
import {
	assertProviderCompliant,
	assertResidencyAllowsBaseUrl,
	DATA_RESIDENCY_HEADER,
	getEffectiveRetentionLevel,
	getRequestDataResidency,
} from "@/lib/compliance.js";
import {
	applyEndUserSession,
	assertTestWalletModelAllowed,
} from "@/lib/end-user-session.js";
import { getLicensedOrganizationEnvVariant } from "@/lib/enterprise.js";
import {
	rateLimitHeaders,
	standardErrorResponses,
} from "@/lib/error-schemas.js";
import { extractApiToken } from "@/lib/extract-api-token.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import { fetchProvider } from "@/lib/fetch-provider.js";
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
import { providerKeyAllowsModel, shortid } from "@llmgateway/db";
import { models as modelDefinitions, type Provider } from "@llmgateway/models";
import { getClientIpFromRequest } from "@llmgateway/shared/client-ip";

import type { RoutingAttempt } from "@/chat/tools/retry-with-fallback.js";
import type { openAIErrorSchema } from "@/lib/error-schemas.js";
import type { ServerTypes } from "@/vars.js";
import type { RoutingMetadata } from "@llmgateway/actions";
import type { InferSelectModel, tables } from "@llmgateway/db";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";
import type { RoutingCredentialSource } from "@llmgateway/shared/routing-telemetry";
import type { Context } from "hono";

const DEFAULT_SEARCH_MODEL = "perplexity-search";

const SEARCH_MODEL_BY_TYPE: Record<string, string> = {
	web: "perplexity-search",
	fast: "perplexity-search-fast",
};

const dateFilterSchema = z
	.string()
	.regex(/^\d{1,2}\/\d{1,2}\/\d{4}$/, "Expected MM/DD/YYYY")
	.optional();

const searchRequestSchema = z.object({
	model: z.string().optional().openapi({
		description:
			"ID of the search model to use. Defaults to perplexity/perplexity-search, or perplexity/perplexity-search-fast when search_type is fast.",
		example: "perplexity/perplexity-search",
	}),
	query: z
		.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(5)])
		.openapi({
			description:
				"Search query, or up to 5 related queries that are searched independently and billed as one request.",
			example: "latest developments in open-source LLMs",
		}),
	search_type: z.enum(["web", "fast", "people"]).optional().openapi({
		description:
			'Perplexity search type. "web" and "fast" select perplexity-search and perplexity-search-fast; "people" is not supported yet.',
		example: "web",
	}),
	max_results: z.number().int().min(1).max(50).optional().openapi({
		description: "Maximum number of results to return. Defaults to 10.",
		example: 5,
	}),
	max_tokens: z.number().int().positive().max(1_000_000).optional().openapi({
		description:
			"Maximum total tokens of extracted content across all results.",
	}),
	max_tokens_per_page: z
		.number()
		.int()
		.positive()
		.max(1_000_000)
		.optional()
		.openapi({
			description: "Maximum tokens of extracted content per result.",
		}),
	search_context_size: z.enum(["low", "medium", "high"]).optional().openapi({
		description: "How much page content to extract per result.",
	}),
	country: z.string().length(2).optional().openapi({
		description: "ISO 3166-1 alpha-2 country code for regional results.",
		example: "US",
	}),
	search_language_filter: z.array(z.string()).max(20).optional().openapi({
		description: "ISO 639-1 language codes to restrict results to.",
	}),
	search_domain_filter: z
		.array(z.string())
		.max(20)
		.optional()
		.openapi({
			description:
				'Domains to restrict results to, or to exclude with a "-" prefix.',
			example: ["arxiv.org", "nature.com"],
		}),
	search_recency_filter: z
		.enum(["hour", "day", "week", "month", "year"])
		.optional()
		.openapi({
			description: "Only return results published within this period.",
		}),
	search_after_date_filter: dateFilterSchema,
	search_before_date_filter: dateFilterSchema,
	last_updated_after_filter: dateFilterSchema,
	last_updated_before_filter: dateFilterSchema,
});

const searchResultSchema = z
	.object({
		title: z.string(),
		url: z.string(),
		snippet: z.string().optional(),
		date: z.string().nullable().optional(),
		last_updated: z.string().nullable().optional(),
	})
	.passthrough();

const searchResponseSchema = z
	.object({
		id: z.string().optional(),
		model: z.string(),
		results: z.array(searchResultSchema),
		server_time: z.string().nullable().optional(),
	})
	.passthrough()
	.openapi({
		description: "Perplexity-compatible search response payload.",
	});

function findSearchMapping(modelId: string): {
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
			if (!candidate.search) {
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

async function assertCreditsAvailableForSearch(
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

export const search = new OpenAPIHono<ServerTypes>();

const createSearch = createRoute({
	operationId: "v1_search",
	summary: "Search",
	description:
		"Search the web and return ranked results with extracted page content. Perplexity Search API-compatible.",
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
					schema: searchRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			headers: rateLimitHeaders,
			content: {
				"application/json": {
					schema: searchResponseSchema,
				},
			},
			description: "Search response with ranked web results.",
		},
		...standardErrorResponses(),
	},
});

search.openapi(createSearch, async (c): Promise<any> => {
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

	const validationResult = searchRequestSchema.safeParse(rawBody);
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
		model: requestedModelInput,
		search_type: requestedSearchType,
		...searchParams
	} = validationResult.data;
	const { query } = searchParams;

	if (requestedSearchType === "people") {
		return c.json(
			{
				error: {
					message: 'search_type "people" is not supported yet',
					type: "invalid_request_error",
					param: "search_type",
					code: "unsupported_search_type",
				},
			},
			400,
		);
	}

	const requestedModel =
		requestedModelInput ??
		(requestedSearchType
			? SEARCH_MODEL_BY_TYPE[requestedSearchType]
			: DEFAULT_SEARCH_MODEL);

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
	await assertMemberProjectAccess(apiKey, baseProject.organizationId);
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

	const retentionLevel = getEffectiveRetentionLevel(organization);

	// 2. Resolve model → provider mapping
	const result = findSearchMapping(requestedModel);
	if (!result) {
		return c.json(
			{
				error: {
					message: `Model ${requestedModel} not found or is not a search model`,
					type: "invalid_request_error",
					param: null,
					code: "model_not_found",
				},
			},
			400,
		);
	}

	const {
		mapping: searchMapping,
		modelDef,
		modelDefId,
		explicitProvider,
	} = result;
	const providerId = searchMapping.providerId;
	const upstreamModel = searchMapping.externalId;
	const responseModel = formatUsedModelForDisplay(
		providerId,
		modelDefId,
		undefined,
		searchMapping.region,
	);

	// For Perplexity the mapping's externalId is the upstream search_type.
	if (requestedSearchType && requestedSearchType !== upstreamModel) {
		return c.json(
			{
				error: {
					message: `search_type "${requestedSearchType}" conflicts with model ${requestedModel}. Omit search_type or use the matching model.`,
					type: "invalid_request_error",
					param: "search_type",
					code: "invalid_parameters",
				},
			},
			400,
		);
	}

	// 3. Validate model output includes "search"
	validateModelOutput(modelDef, requestedModel, ["search"]);

	assertTestWalletModelAllowed(wallet, modelDef);

	if (organization.kind === "devpass" && organization.devPlan !== "none") {
		throw new HTTPException(403, {
			message:
				"Search is not available for coding plans. Coding plans only include text-based inference.",
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
	const compliancePolicy = await assertProviderCompliant(
		organization,
		providerId,
		{
			organizationId: project.organizationId,
			modelId: modelDefId,
			apiKeyId: apiKey.id,
			model: requestedModel,
			dataResidency: getRequestDataResidency(
				c.req.header(DATA_RESIDENCY_HEADER),
			),
			mapping: searchMapping,
		},
	);
	const residencyContext = {
		organizationId: project.organizationId,
		modelId: modelDefId,
		apiKeyId: apiKey.id,
		model: requestedModel,
	};

	const failedKeys = createFailedKeyTracker();
	const routingAttempts: RoutingAttempt[] = [];
	const finalLogId = shortid();

	const buildSearchRoutingMetadata = (
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

	interface SearchAttempt {
		providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
		/** Platform-managed credential when one served this attempt. */
		managedKey: InferSelectModel<typeof tables.providerKey> | undefined;
		usedToken: string;
		configIndex: number;
		envVarName: string | undefined;
		upstreamUrl: string;
		tenantBaseUrl: string | null;
		requestBody: Record<string, unknown>;
	}

	type ResolveResult =
		| { kind: "ok"; attempt: SearchAttempt }
		| {
				kind: "json_error";
				status: 400 | 500;
				body: z.infer<typeof openAIErrorSchema>;
		  };

	async function resolveAttempt(): Promise<ResolveResult> {
		let providerKeyInner:
			InferSelectModel<typeof tables.providerKey> | undefined;
		let managedKeyInner:
			InferSelectModel<typeof tables.providerKey> | undefined;
		let usedToken: string | undefined;
		let configIndex = 0;
		let envVarName: string | undefined;
		const envVariant = getLicensedOrganizationEnvVariant(organization);

		const excludedProviderKeyIds = failedKeys.providerKeyIdsFor(
			providerId,
			undefined,
		);
		const excludedEnvKeyIndices = failedKeys.envKeyIndicesFor(
			providerId,
			undefined,
		);

		const allowsModel = (key: InferSelectModel<typeof tables.providerKey>) =>
			providerKeyAllowsModel(key.allowedModels, modelDefId);

		const resolveCredits = async () => {
			const platformCredential = await resolvePlatformCredential(
				providerId as Provider,
				{
					selectionScope: upstreamModel,
					model: modelDefId,
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
				allowsModel,
			);
			if (!providerKeyInner) {
				throw new HTTPException(400, {
					message: `No API key set for provider: ${providerId}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
				});
			}
			usedToken = readProviderKey(providerKeyInner);
		} else if (project.mode === "credits") {
			await assertCreditsAvailableForSearch(
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
				allowsModel,
			);
			if (providerKeyInner) {
				usedToken = readProviderKey(providerKeyInner);
			} else {
				await assertCreditsAvailableForSearch(
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

		const resolvedBaseUrl =
			providerKeyInner?.baseUrl ??
			getCredentialSetting(
				providerId as Provider,
				"baseUrl",
				{ providerKey: providerKeyInner, managedKey: managedKeyInner },
				{ configIndex, variant: envVariant },
			) ??
			getProviderDefaultBaseUrl(providerId);
		if (!resolvedBaseUrl) {
			throw new HTTPException(500, {
				message: `No base URL set for provider: ${providerId}`,
			});
		}
		await assertResidencyAllowsBaseUrl(
			compliancePolicy,
			providerId,
			resolvedBaseUrl,
			residencyContext,
		);

		const upstreamUrl = `${resolvedBaseUrl}/search`;
		const requestBody: Record<string, unknown> = {
			...searchParams,
			search_type: upstreamModel,
		};

		return {
			kind: "ok",
			attempt: {
				providerKey: providerKeyInner,
				managedKey: managedKeyInner,
				usedToken,
				configIndex,
				envVarName,
				upstreamUrl,
				tenantBaseUrl: providerKeyInner?.baseUrl ?? null,
				requestBody,
			},
		};
	}

	async function resolveNextAttempt(
		failedAttempt: SearchAttempt,
	): Promise<SearchAttempt | null> {
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
	let attempt: SearchAttempt = initialResult.attempt;

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
						content: Array.isArray(query) ? query.join("\n") : query,
					},
				],
				source,
				apiOrigin: "search",
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
				upstreamResponse = await fetchProvider(
					attempt.upstreamUrl,
					{
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
					},
					attempt.tenantBaseUrl,
				);
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
				// A client disconnect says nothing about the credential's health.
				if (!c.req.raw.signal.aborted) {
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
				}

				const networkErrorType = isTimeout
					? "upstream_timeout"
					: "network_error";
				const nextAttempt: SearchAttempt | null =
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

				await insertLog(
					{
						...baseLogEntry,
						id: willRetry ? attemptLogId : finalLogId,
						routingMetadata: buildSearchRoutingMetadata(
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
					},
					{ retentionLevel },
				);

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

			// A 2xx without a results array is not a usable search, so it takes the
			// unbilled failure path instead of being charged as a success.
			if (
				upstreamResponse.ok &&
				!(
					upstreamJson &&
					typeof upstreamJson === "object" &&
					Array.isArray((upstreamJson as { results?: unknown }).results)
				)
			) {
				upstreamResponse = new Response(null, {
					status: 502,
					statusText: "Invalid upstream search response",
				});
				upstreamJson = null;
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
				const nextAttempt: SearchAttempt | null = shouldRetryAlternateKey(
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

				await insertLog(
					{
						...baseLogEntry,
						id: willRetry ? attemptLogId : finalLogId,
						routingMetadata: buildSearchRoutingMetadata(
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
					},
					{ retentionLevel },
				);

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
								: upstreamResponse.statusText || `Upstream error (${status})`,
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

			const normalizedResponse = (
				upstreamJson && typeof upstreamJson === "object" ? upstreamJson : {}
			) as Record<string, unknown>;
			if (!normalizedResponse.id) {
				normalizedResponse.id = requestId;
			}
			normalizedResponse.model = responseModel;

			const requestCost = Number(searchMapping.requestPrice ?? "0");

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

			await insertLog(
				{
					...baseLogEntry,
					id: finalLogId,
					routingMetadata: buildSearchRoutingMetadata(
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
					requestCost,
					webSearchCost: 0,
					imageInputTokens: null,
					imageOutputTokens: null,
					imageInputCost: null,
					imageOutputCost: null,
					cost: requestCost,
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
				},
				{ retentionLevel },
			);

			return c.json(normalizedResponse);
		}
	} finally {
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}
});
