import { HTTPException } from "hono/http-exception";

import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	findCustomProviderKey,
	findProviderKey,
} from "@/lib/cached-queries.js";

import {
	getGcpServiceAccountAccessToken,
	getProviderEndpoint,
	getProviderHeaders,
	isPremiumServiceTier,
	prepareRequestBody,
	providerKeyBaseUrlSupportsServiceTier,
	selectProviderMapping,
} from "@llmgateway/actions";
import {
	type BaseMessage,
	getOrganizationEnvVariant,
	getRegionSpecificEnvVarName,
	getVariantEnvVarNameFor,
	hasMaxTokens,
	type ModelDefinition,
	type OpenAIRequestBody,
	type OpenAIToolInput,
	type PromptCacheOptions,
	type PromptCacheRetention,
	type Provider,
	type ProviderRequestBody,
	providers,
	resolveVertexTokenType,
	type ToolChoiceType,
	type VertexTokenType,
	type WebSearchTool,
} from "@llmgateway/models";
import {
	DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	type DevPlanTier,
	getRemainingPremiumWeeklyAllowance,
	isPremiumModel,
} from "@llmgateway/shared";

import {
	getProviderEnv,
	getServiceTierIneligibleEnvIndices,
} from "./get-provider-env.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

export interface ProviderContext {
	usedProvider: Provider;
	/**
	 * Canonical LLM Gateway model id. Used for everything internal: pricing,
	 * discounts, rate limits, IAM, key selection, logging display. Never the
	 * upstream provider's model id.
	 */
	usedInternalModel: string;
	/**
	 * Provider-specific upstream model id. Reserved for sending the request
	 * to the upstream provider API; do not use for internal lookups.
	 */
	usedExternalId: string;
	usedModelFormatted: string;
	usedModelMapping: string;
	usedToken: string;
	usedApiKeyHash: string;
	providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	/**
	 * Provider-key id to attribute health failures to via reportTrackedKey*.
	 * Equal to `providerKey.id` when the BYOK key is the credential actually
	 * sent, undefined when a regional env-var override replaces the token
	 * (in which case `envVarName` carries the health attribution).
	 */
	trackedKeyHealthId: string | undefined;
	configIndex: number;
	envVarName: string | undefined;
	url: string;
	requestBody: ProviderRequestBody | FormData;
	useResponsesApi: boolean;
	requestCanBeCanceled: boolean;
	isImageGeneration: boolean;
	supportsReasoning: boolean;
	splitTaggedReasoning: boolean;
	healStreamingJsonOutput: boolean;
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
	/**
	 * Parameters dropped because the selected mapping's supportedParameters
	 * doesn't include them. Merged into routingMetadata.strippedParameters so
	 * retry fallbacks keep the logged metadata accurate.
	 */
	strippedParameters: string[];
	headers: Record<string, string>;
	usedRegion: string | undefined;
}

export interface OriginalRequestParams {
	temperature: number | undefined;
	max_tokens: number | undefined;
	top_p: number | undefined;
	frequency_penalty: number | undefined;
	presence_penalty: number | undefined;
}

export interface ProviderContextOptions {
	requestId: string;
	stream: boolean;
	effectiveStream: boolean;
	messages: BaseMessage[];
	response_format: OpenAIRequestBody["response_format"];
	tools: OpenAIToolInput[] | undefined;
	tool_choice: ToolChoiceType | undefined;
	reasoning_effort:
		| "none"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max"
		| undefined;
	reasoning_max_tokens: number | undefined;
	prompt_cache_key: string | undefined;
	prompt_cache_retention: PromptCacheRetention | undefined;
	prompt_cache_options: PromptCacheOptions | undefined;
	session_id: string | undefined;
	effort: "low" | "medium" | "high" | undefined;
	webSearchTool: WebSearchTool | undefined;
	image_config:
		| {
				aspect_ratio?: string;
				image_size?: string;
				image_quality?: string;
				n?: number;
				seed?: number;
		  }
		| undefined;
	sensitive_word_check: { status: "DISABLE" | "ENABLE" } | undefined;
	maxImageSizeMB: number;
	userPlan: "free" | "pro" | "enterprise" | null;
	hasExistingToolCalls: boolean;
	customProviderName: string | undefined;
	webSearchEnabled: boolean;
	excludedEnvKeyIndices?: ReadonlySet<number>;
	excludedProviderKeyIds?: ReadonlySet<string>;
	n?: number;
	providerCacheControlEnabled: boolean;
	service_tier?: "auto" | "default" | "flex" | "priority";
	verbosity?: "low" | "medium" | "high";
}

interface ProjectInfo {
	mode: string;
	organizationId: string;
}

interface OrgInfo {
	id: string;
	credits: string | null;
	plan: string;
	kind: string;
	devPlan: string;
	devPlanCreditsLimit: string | null;
	devPlanCreditsUsed: string | null;
	devPlanPremiumCreditsUsed: string | null;
	devPlanPremiumWeekStart: Date | null;
	devPlanExpiresAt: Date | null;
	chatPlan: string;
	chatPlanCreditsLimit: string | null;
	chatPlanCreditsUsed: string | null;
	chatPlanExpiresAt: Date | null;
}

/**
 * Throws when a DevPass subscriber has exhausted the weekly fair-use
 * allowance for premium-tier models. No-op for non-DevPass orgs and
 * non-premium models.
 */
export function assertDevPlanPremiumCapNotExceeded(
	organization: Pick<
		OrgInfo,
		"devPlan" | "devPlanPremiumCreditsUsed" | "devPlanPremiumWeekStart"
	>,
	modelInfo: Pick<ModelDefinition, "id">,
): void {
	if (organization.devPlan === "none") {
		return;
	}
	if (!isPremiumModel(modelInfo.id)) {
		return;
	}
	const tier = organization.devPlan as DevPlanTier;
	const remaining = getRemainingPremiumWeeklyAllowance(
		tier,
		organization.devPlanPremiumCreditsUsed,
		organization.devPlanPremiumWeekStart,
	);
	if (remaining > 0) {
		return;
	}
	const weekStart = organization.devPlanPremiumWeekStart
		? new Date(organization.devPlanPremiumWeekStart)
		: new Date();
	const resetAt = new Date(
		weekStart.getTime() + DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	);
	const msUntilReset = Math.max(0, resetAt.getTime() - Date.now());
	throw new HTTPException(402, {
		message: `You've used your weekly allowance for premium-tier models on the ${tier} plan. Redeem a Reset Pass from your dashboard for an instant reset, upgrade for a higher allowance, or use any standard model now. Resets in ${formatTimeUntilReset(msUntilReset)}.`,
	});
}

/**
 * Formats a duration as "N days and M hours", dropping zero components and
 * rounding up to the next hour so the wait is never understated.
 */
export function formatTimeUntilReset(ms: number): string {
	if (ms < 60 * 60 * 1000) {
		return "less than an hour";
	}
	const totalHours = Math.ceil(ms / (60 * 60 * 1000));
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	const parts: string[] = [];
	if (days > 0) {
		parts.push(`${days} day${days === 1 ? "" : "s"}`);
	}
	if (hours > 0) {
		parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
	}
	return parts.join(" and ");
}

// Mirrors the initial credit gate in chat.ts so retry/fallback paths that
// switch to LLMGateway env-var tokens cannot be used to bill an organization
// with non-positive credits. Free models (explicitly flagged in the catalog)
// are exempt.
function assertOrganizationHasCreditsForEnvFallback(
	organization: OrgInfo,
	modelInfo: ModelDefinition,
): void {
	if (modelInfo.free) {
		return;
	}
	assertDevPlanPremiumCapNotExceeded(organization, modelInfo);
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
	const totalAvailableCredits =
		regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining;
	if (totalAvailableCredits > 0) {
		return;
	}
	if (
		organization.chatPlan !== "none" &&
		chatPlanCreditsRemaining <= 0 &&
		devPlanCreditsRemaining <= 0
	) {
		const renewalDate = organization.chatPlanExpiresAt
			? new Date(organization.chatPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: `Chat Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		});
	}
	if (organization.devPlan !== "none" && devPlanCreditsRemaining <= 0) {
		const renewalDate = organization.devPlanExpiresAt
			? new Date(organization.devPlanExpiresAt).toLocaleDateString()
			: "your next billing date";
		throw new HTTPException(402, {
			message: `Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
		});
	}
	throw new HTTPException(402, {
		message: `Organization ${organization.id} has insufficient credits`,
	});
}

export function formatUsedModelForDisplay(
	usedProvider: string,
	usedInternalModel: string,
	customProviderName?: string,
	usedRegion?: string,
): string {
	const usedModelProviderPrefix =
		usedProvider === "custom" && customProviderName
			? customProviderName
			: usedProvider;

	const base = `${usedModelProviderPrefix}/${usedInternalModel}`;
	return usedRegion ? `${base}:${usedRegion}` : base;
}

/**
 * Resolves all provider-dependent context needed to make a fetch request.
 * This includes token resolution, URL building, parameter stripping,
 * request body preparation, and header construction.
 *
 * Used by the retry loop to quickly set up a new provider context on fallback.
 */
export async function resolveProviderContext(
	providerMapping: { providerId: string; externalId: string; region?: string },
	project: ProjectInfo,
	organization: OrgInfo,
	modelInfo: ModelDefinition,
	originalParams: OriginalRequestParams,
	options: ProviderContextOptions,
): Promise<ProviderContext> {
	const usedProvider = providerMapping.providerId as Provider;
	// The upstream model id (sent verbatim to the provider API). For BYOK
	// Azure deployments this is overridden by `azure_deployment_name` below.
	const usedExternalId = providerMapping.externalId;
	// The canonical LLM Gateway model id (used for everything internal:
	// pricing, discounts, rate limits, IAM, key selection, logging display).
	// `modelInfo.id` falls back to `usedExternalId` only for custom providers,
	// which have no entry in the registry.
	const usedInternalModel = modelInfo.id || usedExternalId;
	// `usedModelMapping` is the log column that stores the raw upstream id.
	const usedModelMapping = usedExternalId;
	const usedModelFormatted = formatUsedModelForDisplay(
		usedProvider,
		usedInternalModel,
		options.customProviderName,
		providerMapping.region,
	);

	// --- Token resolution ---
	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;
	let configIndex = 0;
	let envVarName: string | undefined;

	// Which env-var variant (`__ENTERPRISE` / `__PLANS` overrides) applies to
	// this org's env-credential reads. Undefined = base vars only.
	const envVariant = getOrganizationEnvVariant(organization);

	// Flex/Priority is only honored when the request reaches the provider's real
	// upstream endpoint. Skip provider keys whose custom base URL (proxy) may
	// silently drop the tier, so a compliant key (or the managed env credential)
	// is used instead.
	const serviceTierKeyFilter = isPremiumServiceTier(options.service_tier)
		? (key: InferSelectModel<typeof tables.providerKey>) =>
				providerKeyBaseUrlSupportsServiceTier(
					key.provider as Provider,
					key.baseUrl,
				)
		: undefined;
	// Exclude env credential indices whose base URL can't honor the tier, merged
	// with any already-failed indices, so env fallback also lands on the upstream.
	const serviceTierEnvExcludedIndices = (
		provider: Provider,
	): ReadonlySet<number> | undefined => {
		if (!serviceTierKeyFilter) {
			return options.excludedEnvKeyIndices;
		}
		const ineligible = getServiceTierIneligibleEnvIndices(provider, envVariant);
		if (ineligible.size === 0) {
			return options.excludedEnvKeyIndices;
		}
		return new Set([...(options.excludedEnvKeyIndices ?? []), ...ineligible]);
	};

	if (project.mode === "api-keys") {
		if (usedProvider === "custom" && options.customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				options.customProviderName,
				usedInternalModel,
				options.excludedProviderKeyIds,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				usedInternalModel,
				options.excludedProviderKeyIds,
				serviceTierKeyFilter,
			);
		}

		if (!providerKey) {
			throw new HTTPException(400, {
				message: `No API key set for provider: ${usedProvider}`,
			});
		}

		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		assertOrganizationHasCreditsForEnvFallback(organization, modelInfo);
		const envResult = getProviderEnv(usedProvider as Provider, {
			excludedIndices: serviceTierEnvExcludedIndices(usedProvider as Provider),
			selectionScope: usedInternalModel,
			variant: envVariant,
		});
		usedToken = envResult.token;
		configIndex = envResult.configIndex;
		envVarName = envResult.envVarName;
	} else if (project.mode === "hybrid") {
		if (usedProvider === "custom" && options.customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				options.customProviderName,
				usedInternalModel,
				options.excludedProviderKeyIds,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				usedInternalModel,
				options.excludedProviderKeyIds,
				serviceTierKeyFilter,
			);
		}

		if (providerKey) {
			usedToken = providerKey.token;
		} else {
			assertOrganizationHasCreditsForEnvFallback(organization, modelInfo);
			const envResult = getProviderEnv(usedProvider as Provider, {
				excludedIndices: serviceTierEnvExcludedIndices(
					usedProvider as Provider,
				),
				selectionScope: usedInternalModel,
				variant: envVariant,
			});
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;
		}
	}

	if (!usedToken) {
		throw new HTTPException(500, { message: "No token" });
	}

	// --- Look up the specific provider mapping for the selected provider ---
	// `modelInfo.providers` is region-expanded only when a provider was explicitly
	// requested; for unpinned routing it holds just the region-agnostic root
	// mapping (`region: undefined`) while `usedRegion` is a concrete value
	// (e.g. AWS Bedrock's `global`). Resolve via the shared fallback helper so a
	// retry/alternate-key request keeps reasoning support instead of dropping it.
	const usedRegion = providerMapping.region;
	const providerMappingForSelected = selectProviderMapping(
		modelInfo.providers,
		usedProvider,
		usedRegion,
	);

	// --- Region validation ---
	// Validate against the expanded model-provider mapping (which contains per-model region info)
	// rather than the provider-level catalog (which lists all regions the provider supports).
	if (usedRegion) {
		const modelRegions = modelInfo.providers
			.filter((p) => p.providerId === usedProvider)
			.map((p) => p.region)
			.filter(Boolean) as string[];
		if (modelRegions.length > 0 && !modelRegions.includes(usedRegion)) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} is not available in region "${usedRegion}". Available regions: ${modelRegions.join(", ")}`,
			});
		}
	}

	// Override with region-specific env var if a non-default region is selected
	// (credits/hybrid mode). Health attribution must follow the credential we
	// actually send.
	if (usedRegion && !providerKey) {
		const regionEnvVarName = getRegionSpecificEnvVarName(
			usedProvider,
			usedRegion,
			envVariant,
		);
		if (regionEnvVarName) {
			const regionToken = process.env[regionEnvVarName];
			if (regionToken) {
				usedToken = regionToken;
				envVarName = regionEnvVarName;
				configIndex = 0;
			}
		}
	}

	const usedApiKeyHash = getApiKeyFingerprint(usedToken);

	// --- Check if model supports reasoning (from selected provider, not any) ---
	const supportsReasoning = providerMappingForSelected?.reasoning === true;
	const splitTaggedReasoning =
		providerMappingForSelected?.splitTaggedReasoning === true;
	const healStreamingJsonOutput =
		providerMappingForSelected?.healStreamingJsonOutput === true;

	// --- Image generation check ---
	const isImageGeneration =
		providerMappingForSelected?.imageGenerations === true;

	// Apply azure_deployment_name override (if set) to the upstream model
	// name. Must run after providerKey is resolved so retry fallbacks also
	// pick up the override.
	const azureDeploymentName =
		usedProvider === "azure"
			? providerKey?.options?.azure_deployment_name
			: undefined;
	const upstreamModelName = azureDeploymentName || usedExternalId;

	// --- URL resolution ---
	// When using a provider key (BYOK), skip env vars entirely —
	// only the provider key's baseUrl or hardcoded provider defaults should be used.
	const isBYOK = providerKey !== undefined;
	// Resolve the Google Vertex token type once and feed it to both the endpoint
	// (`?key=` query param) and the headers (`Authorization: Bearer`) so they
	// never disagree. There is no BYOK region-env override here (the override
	// above only runs when `!providerKey`), so `isBYOK` correctly reflects
	// whether the DB key is the active credential.
	const vertexTokenType: VertexTokenType | undefined =
		usedProvider === "google-vertex"
			? resolveVertexTokenType(
					usedProvider,
					providerKey?.options ?? undefined,
					configIndex,
					isBYOK,
					envVariant,
				)
			: undefined;
	const url = getProviderEndpoint(
		usedProvider as Provider,
		providerKey?.baseUrl ?? undefined,
		upstreamModelName,
		usedProvider === "google-ai-studio" ||
			usedProvider === "glacier" ||
			usedProvider === "google-vertex" ||
			usedProvider === "quartz" ||
			usedProvider === "vertex-anthropic"
			? usedToken
			: undefined,
		options.stream,
		supportsReasoning,
		options.hasExistingToolCalls,
		providerKey?.options ?? undefined,
		configIndex,
		isImageGeneration,
		usedRegion,
		isBYOK,
		usedInternalModel,
		vertexTokenType,
		envVariant,
	);

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}`,
		});
	}

	const useResponsesApi = url.includes("/responses");

	// --- Parameter stripping ---
	// Work with copies of original params to avoid mutation
	let temperature = originalParams.temperature;
	let max_tokens = originalParams.max_tokens;
	let top_p = originalParams.top_p;
	let frequency_penalty = originalParams.frequency_penalty;
	let presence_penalty = originalParams.presence_penalty;

	const strippedParameters: string[] = [];
	if (providerMappingForSelected) {
		const supported = providerMappingForSelected.supportedParameters;
		if (supported && supported.length > 0) {
			if (temperature !== undefined && !supported.includes("temperature")) {
				temperature = undefined;
				strippedParameters.push("temperature");
			}
			if (top_p !== undefined && !supported.includes("top_p")) {
				top_p = undefined;
				strippedParameters.push("top_p");
			}
			if (
				frequency_penalty !== undefined &&
				!supported.includes("frequency_penalty")
			) {
				frequency_penalty = undefined;
				strippedParameters.push("frequency_penalty");
			}
			if (
				presence_penalty !== undefined &&
				!supported.includes("presence_penalty")
			) {
				presence_penalty = undefined;
				strippedParameters.push("presence_penalty");
			}
			if (max_tokens !== undefined && !supported.includes("max_tokens")) {
				max_tokens = undefined;
				strippedParameters.push("max_tokens");
			}
		}
	}

	// Anthropic does not allow temperature and top_p simultaneously
	if (usedProvider === "anthropic" || usedProvider === "vertex-anthropic") {
		if (temperature !== undefined && top_p !== undefined) {
			top_p = undefined;
		}
	}

	// --- max_tokens validation ---
	if (max_tokens !== undefined && providerMappingForSelected) {
		const effectiveMaxOutput = providerMappingForSelected.maxOutput;
		if (effectiveMaxOutput !== undefined) {
			if (max_tokens > effectiveMaxOutput) {
				throw new HTTPException(400, {
					message: `The requested max_tokens (${max_tokens}) exceeds the maximum output tokens allowed for model ${usedInternalModel} (${effectiveMaxOutput})`,
				});
			}
		}
	}

	// --- n parameter validation ---
	// Mirror the initial-path supportsN/maxN/supportsNStreaming checks
	// (chat.ts) so retry fallbacks don't silently drop n by routing to a
	// mapping that doesn't natively accept multiple choices.
	if (options.n !== undefined && options.n > 1) {
		if (!providerMappingForSelected?.supportsN) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} does not support the n parameter for multiple choices. Send n separate requests instead.`,
			});
		}
		if (
			providerMappingForSelected.maxN !== undefined &&
			options.n > providerMappingForSelected.maxN
		) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} supports at most ${providerMappingForSelected.maxN} choices per request (n <= ${providerMappingForSelected.maxN}).`,
			});
		}
		if (
			options.effectiveStream &&
			providerMappingForSelected.supportsNStreaming === false
		) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} does not support the n parameter for multiple choices with streaming. Send a non-streaming request instead.`,
			});
		}
	}

	// --- requestCanBeCanceled ---
	const requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	// --- Request body preparation ---
	const requestBody: ProviderRequestBody | FormData = await prepareRequestBody(
		usedProvider as Provider,
		usedInternalModel,
		providerMapping.region ?? null,
		upstreamModelName,
		options.messages as BaseMessage[],
		options.effectiveStream,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		options.response_format,
		options.tools,
		options.tool_choice,
		options.reasoning_effort,
		supportsReasoning,
		process.env.NODE_ENV === "production",
		options.maxImageSizeMB,
		options.userPlan,
		options.sensitive_word_check,
		options.image_config,
		options.effort,
		isImageGeneration,
		options.webSearchTool,
		options.reasoning_max_tokens,
		useResponsesApi,
		options.prompt_cache_key,
		options.prompt_cache_retention,
		options.providerCacheControlEnabled,
		options.n,
		options.service_tier,
		options.verbosity,
		options.prompt_cache_options,
		options.session_id,
	);

	// Post-validation of max_tokens in request body
	if (
		!(requestBody instanceof FormData) &&
		hasMaxTokens(requestBody) &&
		requestBody.max_tokens !== undefined &&
		providerMappingForSelected
	) {
		if (
			"maxOutput" in providerMappingForSelected &&
			providerMappingForSelected.maxOutput !== undefined
		) {
			if (requestBody.max_tokens > providerMappingForSelected.maxOutput) {
				throw new HTTPException(400, {
					message: `The effective max_tokens (${requestBody.max_tokens}) exceeds the maximum output tokens allowed for model ${usedInternalModel} (${providerMappingForSelected.maxOutput})`,
				});
			}
		}
	}

	// Vertex's OpenAI-compatible endpoint requires an OAuth2 access token
	// derived from the configured service account JSON. The SA JSON is the
	// long-lived credential (kept in usedApiKeyHash above for health tracking)
	// while the short-lived access token is what travels in the Authorization
	// header — so swap usedToken here so downstream header builders just work.
	// Read the env var directly to bypass round-robin comma-splitting (an SA
	// JSON value contains commas and would otherwise be truncated).
	if (usedProvider === "vertex-openai") {
		const fullSaJson = providerKey
			? usedToken
			: (process.env[
					getVariantEnvVarNameFor(
						"LLM_VERTEX_OPENAI_SERVICE_ACCOUNT_JSON",
						envVariant,
					) ?? "LLM_VERTEX_OPENAI_SERVICE_ACCOUNT_JSON"
				] ?? "");
		usedToken = await getGcpServiceAccountAccessToken(fullSaJson);
	}

	// --- Headers ---
	const headers = getProviderHeaders(usedProvider as Provider, usedToken, {
		requestId: options.requestId,
		webSearchEnabled: options.webSearchEnabled,
		tokenType: vertexTokenType,
	});
	headers["Content-Type"] = "application/json";

	if (usedProvider === "anthropic" && options.effort !== undefined) {
		const currentBeta = headers["anthropic-beta"];
		headers["anthropic-beta"] = currentBeta
			? `${currentBeta},effort-2025-11-24`
			: "effort-2025-11-24";
	}

	if (
		usedProvider === "anthropic" &&
		options.response_format?.type === "json_schema"
	) {
		const currentBeta = headers["anthropic-beta"];
		headers["anthropic-beta"] = currentBeta
			? `${currentBeta},structured-outputs-2025-11-13`
			: "structured-outputs-2025-11-13";
	}

	return {
		usedProvider,
		usedInternalModel,
		usedExternalId,
		usedModelFormatted,
		usedModelMapping,
		usedToken,
		usedApiKeyHash,
		providerKey,
		trackedKeyHealthId: providerKey?.id,
		configIndex,
		envVarName,
		url,
		requestBody,
		useResponsesApi,
		requestCanBeCanceled,
		isImageGeneration,
		supportsReasoning,
		splitTaggedReasoning,
		healStreamingJsonOutput,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		strippedParameters,
		headers,
		usedRegion,
	};
}
