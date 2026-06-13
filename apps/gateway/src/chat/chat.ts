import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { detectCodingAgentFromUserAgent } from "@/chat/tools/detect-coding-agent.js";
import { extractFirstSseEventData } from "@/chat/tools/extract-first-sse-event-data.js";
import { validateSource } from "@/chat/tools/validate-source.js";
import { getApiKeyFingerprint } from "@/lib/api-key-fingerprint.js";
import {
	reportKeyError,
	reportKeySuccess,
	reportTrackedKeyError,
	reportTrackedKeySuccess,
} from "@/lib/api-key-health.js";
import { assertApiKeyWithinUsageLimits } from "@/lib/api-key-usage-limits.js";
import {
	findApiKeyByToken,
	findProjectById,
	findOrganizationById,
	findCustomProviderKey,
	findEffectiveDiscount,
	findProviderKey,
	findActiveProviderKeys,
	findProviderKeysByProviders,
} from "@/lib/cached-queries.js";
import { getClientIpFromRequest } from "@/lib/client-ip.js";
import {
	isCodingModel,
	providerSupportsCachedInput,
} from "@/lib/coding-models.js";
import {
	calculateCosts,
	isRefusalFinishReason,
	shouldBillCancelledRequests,
	zeroInferenceCosts,
} from "@/lib/costs.js";
import {
	assertOriginAllowed,
	assertTestWalletModelAllowed,
	loadEndUserWallet,
	withCreditsMode,
	withWalletCredits,
} from "@/lib/end-user-session.js";
import { createFailedKeyTracker } from "@/lib/failed-key-tracker.js";
import {
	getGcpAccessToken,
	getVertexAnthropicProjectId,
} from "@/lib/gcp-token.js";
import { throwIamException, validateRequestModelAccess } from "@/lib/iam.js";
import {
	calculateDataStorageCost,
	getUnifiedFinishReason,
	isContentFilterFinishReason,
	insertLog as _insertLog,
} from "@/lib/logs.js";
import {
	createSessionProviderStore,
	getPreferredProvider,
	resolvePreferredProvider,
	setPreferredProvider,
} from "@/lib/preferred-provider.js";
import { getProviderMetricsForRouting } from "@/lib/provider-metrics-for-routing.js";
import {
	checkProviderRateLimit,
	filterRateLimitedProviders,
	getExceededProviderRateLimitLabels,
	peekProviderRateLimit,
	pickNonRateLimitedCandidates,
	providerRateLimitWindows,
} from "@/lib/provider-rate-limit.js";
import { getResponsesContext } from "@/lib/responses-context.js";
import { getResolvedRoutingConfig } from "@/lib/routing-config-loader.js";
import { getNoFallbackRoutingMetadata } from "@/lib/routing-metadata.js";
import {
	createCombinedSignal,
	createStreamingCombinedSignal,
	isTimeoutError,
} from "@/lib/timeout-config.js";
import { getVertexOpenAIAccessToken } from "@/lib/vertex-openai-token.js";

import {
	applyGoogleServiceTier,
	getCheapestFromAvailableProviders,
	getDiscountedProviderSelectionPrice,
	getProviderEndpoint,
	getProviderHeaders,
	resolveServedServiceTier,
	googleProviderSupportsAudioFormat,
	InvalidFileContentError,
	parseGoogleUpstreamDocumentError,
	prepareRequestBody,
	UnsupportedAudioFormatError,
	UnsupportedDocumentFormatError,
	type RoutingMetadata,
} from "@llmgateway/actions";
import {
	generateCacheKey,
	generateStreamingCacheKey,
	getCache,
	getStreamingCache,
	setCache,
	setStreamingCache,
} from "@llmgateway/cache";
import {
	type InferSelectModel,
	isCachingEnabled,
	metricsKey,
	type LogInsertData,
	shortid,
	type tables,
	type ProviderMetrics,
} from "@llmgateway/db";
import {
	applyRedactions,
	checkGuardrails,
	logViolation,
} from "@llmgateway/guardrails";
import { logger, toError } from "@llmgateway/logger";
import {
	type BaseMessage,
	getModelStreamingSupport,
	hasMaxTokens,
	hasProviderEnvironmentToken,
	hasRegionSpecificEnvKey,
	type ModelDefinition,
	models,
	type Provider,
	type ProviderDefinition,
	type ProviderModelMapping,
	type ProviderRequestBody,
	providers,
	supportsServiceTier,
	type WebSearchTool,
	expandAllProviderRegions,
	getProviderDefinition,
	getRegionSpecificEnvVarName,
	getProviderEnvValue,
} from "@llmgateway/models";
import {
	detectCodingAgentFromReferer,
	detectCodingAgentFromTitle,
	getSupportedAgentsList,
	isChatPlanModelAllowed,
	isRecognizedCodingAgent,
	normalizeSourceToAgentId,
} from "@llmgateway/shared";

import { completionsRequestSchema } from "./schemas/completions.js";
import { anthropicRequestNeedsEffortBeta } from "./tools/anthropic-effort-beta.js";
import { buildRoutingAttempt } from "./tools/build-routing-attempt.js";
import {
	checkContentFilter,
	getContentFilterMethod,
	getContentFilterMode,
	shouldApplyContentFilterToModel,
} from "./tools/check-content-filter.js";
import { collapseImageGenSse } from "./tools/collapse-image-gen-sse.js";
import { convertImagesToBase64 } from "./tools/convert-images-to-base64.js";
import { countInputImages } from "./tools/count-input-images.js";
import { createLogEntry } from "./tools/create-log-entry.js";
import { estimateTokensFromContent } from "./tools/estimate-tokens-from-content.js";
import { estimateTokens } from "./tools/estimate-tokens.js";
import {
	extractAwsBedrockHttpError,
	extractAwsBedrockStreamError,
} from "./tools/extract-aws-bedrock-error.js";
import { extractContent } from "./tools/extract-content.js";
import { extractCustomHeaders } from "./tools/extract-custom-headers.js";
import { extractErrorCause } from "./tools/extract-error-cause.js";
import { extractReasoning } from "./tools/extract-reasoning.js";
import { extractTokenUsage } from "./tools/extract-token-usage.js";
import { extractToolCalls } from "./tools/extract-tool-calls.js";
import { getFinishReasonFromError } from "./tools/get-finish-reason-from-error.js";
import { getProviderEnv } from "./tools/get-provider-env.js";
import { hasMeaningfulAssistantOutput } from "./tools/has-meaningful-assistant-output.js";
import { healJsonResponse } from "./tools/heal-json-response.js";
import { isModelTrulyFree } from "./tools/is-model-truly-free.js";
import { mapFinishReasonToOpenai } from "./tools/map-finish-reason-to-openai.js";
import {
	getAudioFormatsFromMessages,
	messagesContainAudio,
} from "./tools/messages-contain-audio.js";
import { messagesContainDocuments } from "./tools/messages-contain-documents.js";
import { messagesContainImages } from "./tools/messages-contain-images.js";
import { mightBeCompleteJson } from "./tools/might-be-complete-json.js";
import { normalizeStreamingError } from "./tools/normalize-streaming-error.js";
import { checkOpenAIContentFilter } from "./tools/openai-content-filter.js";
import { convertAwsEventStreamToSSE } from "./tools/parse-aws-eventstream.js";
import { parseModelInput } from "./tools/parse-model-input.js";
import { parseProviderResponse } from "./tools/parse-provider-response.js";
import {
	flushTaggedStreamingRemainder,
	splitTaggedStreamingContentChunk,
	splitReasoningFromTaggedContent,
} from "./tools/reasoning-details.js";
import { resolveModelInfo } from "./tools/resolve-model-info.js";
import {
	assertDevPlanPremiumCapNotExceeded,
	formatUsedModelForDisplay,
	resolveProviderContext,
} from "./tools/resolve-provider-context.js";
import {
	type RoutingAttempt,
	getErrorType,
	isRetryableErrorType,
	providerRetryKey,
	selectNextProvider,
	shouldRetryAlternateKey,
	shouldRetryRequest,
} from "./tools/retry-with-fallback.js";
import {
	encodeChatMessages,
	messageContentToString,
} from "./tools/tokenizer.js";
import {
	applyExtendedUsageFields,
	stripRequestScopedMetadataFromOpenAiResponse,
	toResponseMetadataExtras,
	transformResponseToOpenai,
	withCurrentRequestMetadataOnOpenAiResponse,
} from "./tools/transform-response-to-openai.js";
import { transformStreamingToOpenai } from "./tools/transform-streaming-to-openai.js";
import { validateFreeModelUsage } from "./tools/validate-free-model-usage.js";
import { validateModelCapabilities } from "./tools/validate-model-capabilities.js";

import type { OriginalRequestParams } from "./tools/resolve-provider-context.js";
import type { ServerTypes } from "@/vars.js";
import type { ResolvedRoutingConfig } from "@llmgateway/shared/routing-config";

const _derivedProjectId = getVertexAnthropicProjectId();
if (_derivedProjectId && !process.env.LLM_VERTEX_ANTHROPIC_PROJECT) {
	process.env.LLM_VERTEX_ANTHROPIC_PROJECT = _derivedProjectId;
}

/**
 * Filter expanded region entries to only those with available API keys.
 * - Non-regional mappings (no region) pass through unchanged.
 * - The default region for a provider always passes (uses the base env key).
 * - Non-default regions only pass if a region-specific env key exists
 *   (e.g. LLM_ALIBABA_API_KEY__US_VIRGINIA).
 */
/**
 * Inject stream=true and partial_images=1 into an OpenAI/Azure gpt-image-*
 * request body so the upstream call uses SSE. The single partial keeps the
 * connection alive past Azure's 122s synchronous wall; the gateway discards
 * the partial event and returns only the final image to the client.
 *
 * Multipart caveat: Azure's /v1/images/edits parses the stream form field with
 * a case-sensitive boolean parser (.NET-style) — "true" (lowercase) is treated
 * as falsy and Azure runs the request synchronously, hitting the 122s wall.
 * "True" (Pascal case, matching httpx's str(True) encoding used by the Python
 * SDK) is parsed correctly. OpenAI accepts both cases, so "True" is safe for
 * both providers. JSON bodies are unaffected — native booleans go on the wire
 * as `true` and parse correctly everywhere.
 */
function injectImageStreamParams(
	body: ProviderRequestBody | FormData,
): ProviderRequestBody | FormData {
	if (body instanceof FormData) {
		body.set("stream", "True");
		body.set("partial_images", "1");
		return body;
	}
	return {
		...(body as unknown as Record<string, unknown>),
		stream: true,
		partial_images: 1,
	} as unknown as ProviderRequestBody;
}

function toDataStorageCostNumber(
	promptTokens: number | string | null | undefined,
	cachedTokens: number | string | null | undefined,
	completionTokens: number | string | null | undefined,
	reasoningTokens: number | string | null | undefined,
	retentionLevel: "retain" | "none" | null,
): number | null {
	if (retentionLevel === "none") {
		return null;
	}
	const str = calculateDataStorageCost(
		promptTokens,
		cachedTokens,
		completionTokens,
		reasoningTokens,
		retentionLevel,
	);
	const num = Number(str);
	return Number.isFinite(num) ? num : null;
}

function filterRegionsByAvailableKeys(
	expandedProviders: ProviderModelMapping[],
): ProviderModelMapping[] {
	return expandedProviders.filter((mapping) => {
		if (!mapping.region) {
			return true;
		}
		const providerDef = providers.find((p) => p.id === mapping.providerId) as
			| ProviderDefinition
			| undefined;
		if (!providerDef?.regionConfig) {
			return true;
		}
		if (mapping.region === providerDef.regionConfig.defaultRegion) {
			return true;
		}
		return hasRegionSpecificEnvKey(
			mapping.providerId as Provider,
			mapping.region,
		);
	});
}

/**
 * For providers with `regionConfig.pinDefaultRegion: true`, drop all regional
 * candidates except the defaultRegion (and the synthetic root) when no
 * explicit choice was made. This makes AWS Bedrock default to `:global`
 * unless the caller opts in via the `:region` URL suffix or via the
 * provider-key region option. Providers without `pinDefaultRegion`
 * (e.g. Alibaba) pass through unchanged so the gateway can route to the
 * cheapest region.
 */
function applyPinnedDefaultRegions(
	mappings: ProviderModelMapping[],
	options: {
		explicitLocks?: Map<string, string>;
		requestedRegion?: string;
	} = {},
): ProviderModelMapping[] {
	if (options.requestedRegion) {
		return mappings;
	}
	return mappings.filter((m) => {
		const def = providers.find((p) => p.id === m.providerId) as
			| ProviderDefinition
			| undefined;
		if (!def?.regionConfig?.pinDefaultRegion) {
			return true;
		}
		if (options.explicitLocks?.has(m.providerId)) {
			return true;
		}
		return !m.region || m.region === def.regionConfig.defaultRegion;
	});
}

function preferConcreteRegionalMappings(
	providers: ProviderModelMapping[],
): ProviderModelMapping[] {
	const providersWithRegions = new Set(
		providers
			.filter((mapping) => mapping.region)
			.map((mapping) => mapping.providerId),
	);

	return providers.filter(
		(mapping) =>
			!providersWithRegions.has(mapping.providerId) || Boolean(mapping.region),
	);
}

function createProviderDiscountResolver(organizationId: string) {
	return async (
		provider: Pick<ProviderModelMapping, "providerId">,
		modelId: string,
	) =>
		(await findEffectiveDiscount(organizationId, provider.providerId, modelId))
			.discount;
}

async function collapseProvidersToBestRegionPerProvider(
	candidates: ProviderModelMapping[],
	model: ModelDefinition & {
		id: string;
		output?: string[];
	},
	options: {
		metricsMap: Map<string, ProviderMetrics>;
		isStreaming: boolean;
		promptTokens?: number;
		routingConfig?: ResolvedRoutingConfig;
		organizationId: string;
	},
): Promise<ProviderModelMapping[]> {
	const providersById = new Map<string, ProviderModelMapping[]>();

	for (const candidate of candidates) {
		const providerCandidates = providersById.get(candidate.providerId) ?? [];
		providerCandidates.push(candidate);
		providersById.set(candidate.providerId, providerCandidates);
	}

	const collapsedProviders = await Promise.all(
		Array.from(providersById.values()).map(async (providerCandidates) => {
			if (providerCandidates.length === 1) {
				return providerCandidates[0];
			}

			const bestCandidate = await getCheapestFromAvailableProviders(
				providerCandidates,
				model,
				{
					...options,
					providerDiscountResolver: createProviderDiscountResolver(
						options.organizationId,
					),
				},
			);

			return bestCandidate?.provider ?? providerCandidates[0];
		}),
	);

	return collapsedProviders;
}

function resolveRegionFromProviderKey(
	key: InferSelectModel<typeof tables.providerKey>,
): string | undefined {
	const providerDef = providers.find((p) => p.id === key.provider) as
		| ProviderDefinition
		| undefined;
	if (!providerDef?.regionConfig) {
		return undefined;
	}
	const regionKey = providerDef.regionConfig.optionsKey;
	const explicitRegion = key.options
		? (key.options as Record<string, string | undefined>)[regionKey]
		: undefined;
	return explicitRegion ?? providerDef.regionConfig.defaultRegion;
}

function resolveExplicitRegionFromProviderKey(
	key: InferSelectModel<typeof tables.providerKey>,
): string | undefined {
	const providerDef = providers.find((p) => p.id === key.provider) as
		| ProviderDefinition
		| undefined;
	if (!providerDef?.regionConfig) {
		return undefined;
	}
	const regionKey = providerDef.regionConfig.optionsKey;
	return key.options
		? (key.options as Record<string, string | undefined>)[regionKey]
		: undefined;
}

/**
 * Build a provider → locked-region map from DB provider keys. When a user sets
 * a region on their provider key (e.g. `aws_bedrock_region: "eu"`), only that
 * region should be a routing candidate for the provider.
 */
function buildProviderLockedRegions(
	providerKeys: InferSelectModel<typeof tables.providerKey>[],
): Map<string, string> {
	const locked = new Map<string, string>();
	for (const key of providerKeys) {
		const providerDef = providers.find((p) => p.id === key.provider) as
			| ProviderDefinition
			| undefined;
		const regionKey = providerDef?.regionConfig?.optionsKey;
		if (regionKey && key.options) {
			const lockedRegion = (key.options as Record<string, string | undefined>)[
				regionKey
			];
			if (lockedRegion) {
				locked.set(key.provider, lockedRegion);
			}
		}
	}
	return locked;
}

/**
 * Whether the given model exposes any region-specific mapping for the provider.
 * Used to avoid applying a provider key's default region (e.g. AWS Bedrock's
 * `global`) to models that have no regional variants — doing so would set a
 * `usedRegion` that the (providerId, region) capability lookup can't match,
 * silently dropping capabilities like reasoning support.
 */
function modelHasRegionalMappingsForProvider(
	model: { providers: ProviderModelMapping[] } | undefined,
	provider: string,
): boolean {
	return Boolean(
		model?.providers.some((p) => p.providerId === provider && p.region),
	);
}

function filterEligibleModelProviders(
	availableModelProviders: ProviderModelMapping[],
	options: {
		allProviderVariants: ProviderModelMapping[];
		availableProviders?: string[];
		providerLockedRegions?: Map<string, string>;
		webSearchTool?: WebSearchTool;
		responseFormatType?: string;
		hasImages: boolean;
		hasAudio: boolean;
		audioFormats?: string[];
		hasDocuments: boolean;
		maxTokens?: number;
		reasoningEffort?: string;
		n?: number;
	},
): ProviderModelMapping[] {
	return availableModelProviders.filter((provider) => {
		if (
			options.availableProviders &&
			!options.availableProviders.includes(provider.providerId)
		) {
			return false;
		}

		const lockedRegion = options.providerLockedRegions?.get(
			provider.providerId,
		);
		if (lockedRegion && provider.region && provider.region !== lockedRegion) {
			return false;
		}

		if (options.webSearchTool && provider.webSearch !== true) {
			return false;
		}

		// Exclude mappings that can't natively serve n > 1 so routing skips
		// over them instead of selecting one and failing the post-selection
		// supportsN guard. The post-guard stays as a safety net.
		if (
			options.n !== undefined &&
			options.n > 1 &&
			provider.supportsN !== true
		) {
			return false;
		}

		if (
			options.responseFormatType === "json_object" ||
			options.responseFormatType === "json_schema"
		) {
			if (provider.jsonOutput !== true) {
				return false;
			}
		}

		if (
			options.responseFormatType === "json_schema" &&
			provider.jsonOutputSchema !== true
		) {
			return false;
		}

		if (options.hasImages && provider.vision !== true) {
			return false;
		}

		if (options.hasAudio && provider.audio !== true) {
			return false;
		}

		if (
			options.hasAudio &&
			options.audioFormats &&
			options.audioFormats.length > 0 &&
			!options.audioFormats.every((fmt) =>
				googleProviderSupportsAudioFormat(provider.providerId, fmt),
			)
		) {
			return false;
		}

		if (options.hasDocuments && provider.document !== true) {
			return false;
		}

		if (
			options.maxTokens !== undefined &&
			provider.maxOutput !== undefined &&
			options.maxTokens > provider.maxOutput
		) {
			return false;
		}

		// "none" means "no reasoning", so it doesn't require a reasoning-capable
		// provider. Let it fall through so non-reasoning variants stay eligible.
		if (
			options.reasoningEffort !== undefined &&
			options.reasoningEffort !== "none"
		) {
			return provider.reasoning === true;
		}

		const hasNonReasoningAlternative = options.allProviderVariants.some(
			(p) => p.providerId === provider.providerId && p.reasoning !== true,
		);

		if (hasNonReasoningAlternative && provider.reasoning === true) {
			return false;
		}

		return true;
	});
}

interface ContentFilterRoutingDecision {
	candidates: ProviderModelMapping[];
	excludedProviders: ProviderModelMapping[];
	rerouted: boolean;
}

function isContentFilterProvider(providerId: string): boolean {
	return getProviderDefinition(providerId)?.contentFilter === true;
}

function getContentFilterRoutingDecision(
	availableModelProviders: ProviderModelMapping[],
	contentFilterMatched: boolean,
): ContentFilterRoutingDecision {
	if (!contentFilterMatched) {
		return {
			candidates: availableModelProviders,
			excludedProviders: [],
			rerouted: false,
		};
	}

	const preferredProviders = availableModelProviders.filter(
		(provider) => !isContentFilterProvider(provider.providerId),
	);

	if (preferredProviders.length === 0) {
		return {
			candidates: availableModelProviders,
			excludedProviders: [],
			rerouted: false,
		};
	}

	const excludedProviders = availableModelProviders.filter((provider) =>
		isContentFilterProvider(provider.providerId),
	);

	if (excludedProviders.length === 0) {
		return {
			candidates: availableModelProviders,
			excludedProviders: [],
			rerouted: false,
		};
	}

	return {
		candidates: preferredProviders,
		excludedProviders,
		rerouted: true,
	};
}

async function addContentFilterRoutingMetadata(
	routingMetadata: RoutingMetadata,
	contentFilterMatched: boolean,
	excludedProviders: ProviderModelMapping[],
	modelId: string | undefined,
	metricsMap: Map<string, ProviderMetrics>,
	organizationId: string,
	providerDiscountResolver: ReturnType<typeof createProviderDiscountResolver>,
): Promise<RoutingMetadata> {
	if (!contentFilterMatched) {
		return routingMetadata;
	}

	const contentFilterExcludedProviders = [
		...new Set(excludedProviders.map((provider) => provider.providerId)),
	];

	const providerScores =
		excludedProviders.length === 0 || !modelId
			? routingMetadata.providerScores
			: [
					...(await Promise.all(
						excludedProviders.map(async (provider) => {
							const metrics = metricsMap.get(
								metricsKey(modelId, provider.providerId, provider.region),
							);
							const { price, discount } =
								await getDiscountedProviderSelectionPrice(provider, modelId, {
									organizationId,
									providerDiscountResolver,
								});

							return {
								providerId: provider.providerId,
								region: provider.region,
								score: -1,
								uptime: metrics?.uptime ?? 0,
								latency: metrics?.averageLatency ?? 0,
								throughput: metrics?.throughput ?? 0,
								price: price.toNumber(),
								discount: discount.toNumber(),
								contentFilterProvider: true,
								excludedByContentFilter: true,
							};
						}),
					)),
					...routingMetadata.providerScores,
				];

	return {
		...routingMetadata,
		contentFilterMatched: true,
		contentFilterRerouted: contentFilterExcludedProviders.length > 0,
		contentFilterExcludedProviders:
			contentFilterExcludedProviders.length > 0
				? contentFilterExcludedProviders
				: undefined,
		providerScores,
	};
}

function withUsedApiKeyHash(
	routingMetadata: RoutingMetadata | undefined,
	usedApiKeyHash: string | undefined,
): RoutingMetadata | undefined {
	if (!routingMetadata || !usedApiKeyHash) {
		return routingMetadata;
	}

	if (routingMetadata.usedApiKeyHash === usedApiKeyHash) {
		return routingMetadata;
	}

	return {
		...routingMetadata,
		usedApiKeyHash,
	};
}

function usesGoogleQueryToken(provider: string): boolean {
	return (
		provider === "google-ai-studio" ||
		provider === "glacier" ||
		provider === "google-vertex" ||
		provider === "quartz"
	);
}

function isGoogleCompatibleProvider(provider: string): boolean {
	return (
		provider === "google-ai-studio" ||
		provider === "glacier" ||
		provider === "google-vertex" ||
		provider === "quartz"
	);
}

function isVertexCompatibleProvider(provider: string): boolean {
	return provider === "google-vertex" || provider === "quartz";
}

/**
 * Dev-only verification log confirming a requested processing tier reached the
 * provider. AI Studio reports the served tier in the `x-gemini-service-tier`
 * response header; Vertex reports it in `usageMetadata.trafficType` (logged
 * separately once the response body is parsed).
 */
function logServiceTierRequest(
	provider: string,
	serviceTier: string | undefined,
	res: Response | undefined,
): void {
	if (
		process.env.NODE_ENV === "production" ||
		(serviceTier !== "flex" && serviceTier !== "priority") ||
		!isGoogleCompatibleProvider(provider)
	) {
		return;
	}
	logger.debug("service_tier request sent", {
		provider,
		requestedServiceTier: serviceTier,
		transport: isVertexCompatibleProvider(provider)
			? "X-Vertex-AI-LLM-Shared-Request-Type header"
			: "service_tier body field",
		servedServiceTier: res?.headers.get("x-gemini-service-tier") ?? null,
		status: res?.status,
	});
}

/**
 * Dev-only verification log for the served Vertex tier. Vertex echoes the
 * applied tier in `usageMetadata.trafficType` (ON_DEMAND_PRIORITY /
 * ON_DEMAND_FLEX, or plain ON_DEMAND when downgraded under load).
 */
function logVertexTrafficType(
	provider: string,
	serviceTier: string | undefined,
	data: { usageMetadata?: { trafficType?: string } } | undefined,
): void {
	const trafficType = data?.usageMetadata?.trafficType;
	if (
		process.env.NODE_ENV === "production" ||
		(serviceTier !== "flex" && serviceTier !== "priority") ||
		!isVertexCompatibleProvider(provider) ||
		!trafficType
	) {
		return;
	}
	logger.debug("service_tier served (vertex trafficType)", {
		provider,
		requestedServiceTier: serviceTier,
		trafficType,
		downgraded: trafficType === "ON_DEMAND",
	});
}

function readServiceTierValue(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.service_tier === "string") {
		return record.service_tier;
	}

	if (typeof record.response === "object" && record.response !== null) {
		return readServiceTierValue(record.response);
	}

	return undefined;
}

function resolveOpenAIServiceTier(
	data: unknown,
): "flex" | "priority" | null | undefined {
	const serviceTier = readServiceTierValue(data);
	if (serviceTier === undefined) {
		return undefined;
	}
	const normalized = serviceTier.toLowerCase();
	if (normalized === "flex" || normalized === "priority") {
		return normalized;
	}
	return null;
}

function getForwardedServiceTier(
	model: string,
	provider: Provider,
	region: string | undefined,
	serviceTier: "auto" | "default" | "flex" | "priority" | undefined,
	configIndex?: number,
): "flex" | "priority" | undefined {
	if (serviceTier !== "flex" && serviceTier !== "priority") {
		return undefined;
	}
	const effectiveRegion =
		provider === "google-vertex"
			? (region ??
				getProviderEnvValue("google-vertex", "region", configIndex, "global") ??
				"global")
			: region;
	return supportsServiceTier(
		model,
		provider,
		serviceTier,
		effectiveRegion ?? null,
	)
		? serviceTier
		: undefined;
}

function isRequestedServiceTier(
	serviceTier: "auto" | "default" | "flex" | "priority" | undefined,
): serviceTier is "flex" | "priority" {
	return serviceTier === "flex" || serviceTier === "priority";
}

function providerMatchesRequestedProvider(
	mapping: ProviderModelMapping,
	requestedProvider: Provider | undefined,
): boolean {
	return (
		!requestedProvider ||
		requestedProvider === "llmgateway" ||
		mapping.providerId === requestedProvider
	);
}

function mappingSupportsRequestedServiceTier(
	model: string,
	mapping: ProviderModelMapping,
	serviceTier: "flex" | "priority",
	configIndex?: number,
): boolean {
	const effectiveRegion =
		mapping.providerId === "google-vertex"
			? (mapping.region ??
				getProviderEnvValue("google-vertex", "region", configIndex, "global") ??
				"global")
			: mapping.region;
	return supportsServiceTier(
		model,
		mapping.providerId,
		serviceTier,
		effectiveRegion ?? null,
	);
}

// Pre-compiled regex pattern to avoid recompilation per request
const SSE_FIELD_PATTERN = /^[a-zA-Z_-]+:\s*/;
const IMMEDIATE_STREAM_ERROR_PEEK_LIMIT = 64 * 1024;

function inferStreamingErrorStatusCode(
	openAiCompatibleStreamError: Record<string, unknown>,
	errorResponseText: string,
): number {
	if (typeof openAiCompatibleStreamError.status_code === "number") {
		return openAiCompatibleStreamError.status_code;
	}
	if (typeof openAiCompatibleStreamError.status === "number") {
		return openAiCompatibleStreamError.status;
	}

	const errorType =
		typeof openAiCompatibleStreamError.type === "string"
			? openAiCompatibleStreamError.type.toLowerCase()
			: "";
	const errorCode =
		typeof openAiCompatibleStreamError.code === "string"
			? openAiCompatibleStreamError.code.toLowerCase()
			: "";
	const errorMessage =
		typeof openAiCompatibleStreamError.message === "string"
			? openAiCompatibleStreamError.message.toLowerCase()
			: "";
	const errorText = errorResponseText.toLowerCase();

	if (
		errorType === "authentication_error" ||
		errorCode === "invalid_api_key" ||
		errorMessage.includes("invalid api key") ||
		errorMessage.includes("incorrect api key")
	) {
		return 401;
	}
	if (errorType === "permission_error" || errorCode === "forbidden") {
		return 403;
	}
	if (
		errorType === "rate_limit_error" ||
		errorCode === "rate_limit_exceeded" ||
		errorMessage.includes("rate limit") ||
		errorText.includes("rate limit")
	) {
		return 429;
	}
	if (
		errorCode === "model_not_found" ||
		errorMessage.includes("does not exist") ||
		errorMessage.includes("not found") ||
		errorText.includes("model_not_found")
	) {
		return 404;
	}
	if (
		errorType === "content_filter" ||
		errorCode === "content_filter" ||
		errorText.includes("responsibleaipolicyviolation") ||
		errorText.includes("sensitivecontentdetected") ||
		errorType === "data_inspection_failed" ||
		errorCode === "data_inspection_failed" ||
		errorText.includes("input data may contain inappropriate content") ||
		errorText.includes("content violates usage guidelines")
	) {
		return 400;
	}
	if (
		errorType === "invalid_request_error" ||
		errorType === "invalid_argument"
	) {
		return 400;
	}

	return 500;
}

export async function inspectImmediateStreamingProviderError(
	response: Response,
	provider: Provider,
): Promise<
	| {
			response: Response;
			immediateError: null;
	  }
	| {
			response: Response;
			immediateError: {
				errorCode: string;
				errorMessage: string;
				errorResponseText: string;
				errorType: string;
				inferredStatusCode: number;
				statusText: string;
			};
	  }
> {
	if (!response.body || provider === "aws-bedrock") {
		return {
			response,
			immediateError: null,
		};
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const replayChunks: Uint8Array[] = [];
	let peekBuffer = "";

	try {
		while (peekBuffer.length < IMMEDIATE_STREAM_ERROR_PEEK_LIMIT) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			replayChunks.push(value);
			peekBuffer += decoder.decode(value, { stream: true });

			const firstEventData = extractFirstSseEventData(peekBuffer);
			if (!firstEventData) {
				continue;
			}

			let parsedEvent: unknown;
			try {
				parsedEvent = JSON.parse(firstEventData);
			} catch {
				break;
			}

			const openAiCompatibleStreamError =
				parsedEvent &&
				typeof parsedEvent === "object" &&
				"error" in parsedEvent &&
				parsedEvent.error &&
				typeof parsedEvent.error === "object"
					? (parsedEvent.error as Record<string, unknown>)
					: null;

			if (!openAiCompatibleStreamError) {
				break;
			}

			const errorResponseText = JSON.stringify(parsedEvent);
			const inferredStatusCode = inferStreamingErrorStatusCode(
				openAiCompatibleStreamError,
				errorResponseText,
			);
			const errorType = getFinishReasonFromError(
				inferredStatusCode,
				errorResponseText,
			);
			const errorMessage =
				typeof openAiCompatibleStreamError.message === "string"
					? openAiCompatibleStreamError.message
					: "Upstream provider returned a streaming error";
			const errorCode =
				typeof openAiCompatibleStreamError.code === "string"
					? openAiCompatibleStreamError.code
					: typeof openAiCompatibleStreamError.type === "string"
						? openAiCompatibleStreamError.type
						: errorType;
			const statusText =
				typeof openAiCompatibleStreamError.type === "string"
					? openAiCompatibleStreamError.type
					: "stream_error";

			try {
				await reader.cancel();
			} catch {
				// Ignore cancellation errors - the response body is no longer needed.
			}

			return {
				response,
				immediateError: {
					errorCode,
					errorMessage,
					errorResponseText,
					errorType,
					inferredStatusCode,
					statusText,
				},
			};
		}
	} catch (error) {
		try {
			await reader.cancel();
		} catch {
			// Ignore cancellation errors - the response body is no longer needed.
		}

		return {
			response,
			immediateError: {
				errorCode: "stream_read_error",
				errorMessage:
					error instanceof Error ? error.message : String(error ?? ""),
				errorResponseText: "",
				errorType: "upstream_error",
				inferredStatusCode: 502,
				statusText: "stream_read_error",
			},
		};
	}

	const replayStream = new ReadableStream<Uint8Array>({
		async start(controller) {
			try {
				for (const chunk of replayChunks) {
					controller.enqueue(chunk);
				}

				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					controller.enqueue(value);
				}

				controller.close();
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} catch {
				// Ignore cancellation errors when the replay stream is closed early.
			}
		},
	});

	return {
		response: new Response(replayStream, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers),
		}),
		immediateError: null,
	};
}

// Reusable TextDecoder to avoid per-chunk allocation in the streaming hot path
const sharedTextDecoder = new TextDecoder();

export const chat = new OpenAPIHono<ServerTypes>();

const completions = createRoute({
	operationId: "v1_chat_completions",
	summary: "Chat Completions",
	description: "Create a completion for the chat conversation",
	method: "post",
	path: "/completions",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: completionsRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						object: z.string(),
						created: z.number(),
						model: z.string(),
						choices: z.array(
							z.object({
								index: z.number(),
								message: z.object({
									role: z.string(),
									content: z.string().nullable(),
									reasoning: z.string().nullable().optional(),
									tool_calls: z
										.array(
											z.object({
												id: z.string(),
												type: z.literal("function"),
												function: z.object({
													name: z.string(),
													arguments: z.string(),
												}),
											}),
										)
										.optional(),
									images: z
										.array(
											z.object({
												type: z.literal("image_url"),
												image_url: z.object({
													url: z.string(),
												}),
											}),
										)
										.optional(),
								}),
								finish_reason: z.string(),
							}),
						),
						usage: z.object({
							prompt_tokens: z.number(),
							completion_tokens: z.number(),
							total_tokens: z.number(),
							reasoning_tokens: z.number().optional(),
							prompt_tokens_details: z
								.object({
									cached_tokens: z.number(),
									cache_write_tokens: z.number().optional(),
									cache_creation_tokens: z.number().optional(),
									cache_creation: z
										.object({
											ephemeral_5m_input_tokens: z.number(),
											ephemeral_1h_input_tokens: z.number(),
										})
										.optional(),
									audio_tokens: z.number().optional(),
									video_tokens: z.number().optional(),
								})
								.optional(),
							completion_tokens_details: z
								.object({
									reasoning_tokens: z.number().optional(),
									image_tokens: z.number().optional(),
									audio_tokens: z.number().optional(),
								})
								.optional(),
							cost: z.number().nullable().optional(),
							cost_details: z
								.object({
									upstream_inference_cost: z.number(),
									upstream_inference_prompt_cost: z.number(),
									upstream_inference_completions_cost: z.number(),
									total_cost: z.number().nullable().optional(),
									input_cost: z.number().nullable().optional(),
									output_cost: z.number().nullable().optional(),
									cached_input_cost: z.number().nullable().optional(),
									cache_write_input_cost: z.number().nullable().optional(),
									request_cost: z.number().nullable().optional(),
									web_search_cost: z.number().nullable().optional(),
									image_input_cost: z.number().nullable().optional(),
									image_output_cost: z.number().nullable().optional(),
									audio_input_cost: z.number().nullable().optional(),
									data_storage_cost: z.number().nullable().optional(),
								})
								.optional(),
							info: z.string().optional(),
						}),
						metadata: z.object({
							request_id: z.string(),
							requested_model: z.string(),
							requested_provider: z.string().nullable(),
							used_model: z.string(),
							used_provider: z.string(),
							used_region: z.string().nullable().optional(),
							underlying_used_model: z.string(),
							log_id: z.string().optional(),
							organization_id: z.string().optional(),
							project_id: z.string().optional(),
							discount: z.number().nullable().optional(),
							routing: z
								.array(
									z.object({
										provider: z.string(),
										model: z.string(),
										region: z.string().optional(),
										status_code: z.number(),
										error_type: z.string(),
										succeeded: z.boolean(),
										apiKeyHash: z.string().optional(),
										logId: z.string().optional(),
									}),
								)
								.optional(),
						}),
					}),
				},
				"text/event-stream": {
					schema: z.any(),
				},
			},
			description: "User response object or streaming response.",
		},
		500: {
			content: {
				"application/json": {
					schema: z.object({
						error: z.object({
							message: z.string(),
							type: z.string(),
							param: z.string().nullable(),
							code: z.string(),
						}),
					}),
				},
				"text/event-stream": {
					schema: z.any(),
				},
			},
			description: "Error response object.",
		},
	},
});

chat.openapi(completions, async (c) => {
	// Extract or generate request ID
	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);

	// Parse JSON manually even if it's malformed
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

	// Validate against schema
	const validationResult = completionsRequestSchema.safeParse(rawBody);
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
		model: modelInput,
		response_format,
		stream,
		prompt_cache_key,
		prompt_cache_retention,
		tool_choice,
		free_models_only,
		onboarding,
		no_reasoning,
		sensitive_word_check,
		image_config,
		effort,
		service_tier,
		web_search,
		plugins,
		n,
		user,
	} = validationResult.data;

	// Sticky-routing session key, in priority order: the explicit x-session-id
	// header, then x-session-affinity (sent by coding agents such as opencode),
	// then the OpenAI-native body fields (prompt_cache_key, then user). When
	// present, provider selection pins this session to a single provider to keep
	// upstream prompt caches warm.
	const sessionId =
		c.req.header("x-session-id")?.trim() ||
		c.req.header("x-session-affinity")?.trim() ||
		prompt_cache_key ||
		user ||
		undefined;
	let {
		messages,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		tools,
	} = validationResult.data;

	// Debug: Log tools received from the AI SDK (development only)
	if (process.env.NODE_ENV !== "production" && tools && tools.length > 0) {
		logger.debug("Tools received by gateway", { count: tools.length });
		for (const tool of tools) {
			if (tool.type === "function") {
				logger.debug(`Function tool: ${tool.function?.name || "unknown"}`, {
					hasParameters: !!tool.function?.parameters,
					parametersPreview: tool.function?.parameters
						? JSON.stringify(tool.function.parameters).slice(0, 500)
						: "none",
				});
			} else if (tool.type === "web_search") {
				logger.debug("Web search tool configured");
			}
		}
	}

	// If web_search parameter is true, automatically add the web_search tool
	if (web_search && (!tools || !tools.some((t) => t.type === "web_search"))) {
		tools = tools ?? [];
		tools.push({
			type: "web_search" as const,
		});
	}

	// Detect whether the caller marked any content with `cache_control` for an
	// explicit-cache flow. Providers with a split read rate (e.g., Alibaba: 10%
	// explicit vs. 20% implicit) consume this flag in calculateCosts to bill
	// cached read tokens at the right rate.
	const explicitCacheUsed = messages.some(
		(m) =>
			Array.isArray(m.content) &&
			m.content.some(
				(part) =>
					part &&
					typeof part === "object" &&
					(part as { cache_control?: unknown }).cache_control !== undefined,
			),
	);

	// Extract reasoning.effort and reasoning.max_tokens for unified reasoning configuration
	const reasoning_object_effort = validationResult.data.reasoning?.effort;
	const reasoning_max_tokens = validationResult.data.reasoning?.max_tokens;

	// Validate that reasoning_effort and reasoning.effort are not both specified
	if (
		validationResult.data.reasoning_effort !== undefined &&
		reasoning_object_effort !== undefined
	) {
		return c.json(
			{
				error: {
					message:
						"Cannot specify both reasoning_effort and reasoning.effort. Use one or the other.",
					type: "invalid_request_error",
					code: "invalid_request",
				},
			},
			400,
		);
	}

	// Extract reasoning_effort as mutable variable for auto-routing modification
	// Use reasoning.effort if provided, otherwise use top-level reasoning_effort.
	// "none" is preserved and forwarded to OpenAI (its newer reasoning models
	// accept it); for other providers it is normalized to "off" downstream in
	// prepareRequestBody.
	let reasoning_effort =
		reasoning_object_effort ?? validationResult.data.reasoning_effort;

	// Reject n > 1 with streaming + function tools: the streaming tool-call
	// aggregator keys deltas only by tc.index (the tool position within a
	// choice), so concurrent function calls across choices would collide.
	// Native web_search tools (and the web_search: true flag) don't flow
	// through that aggregator — they're handled upstream — so they're
	// exempt. n > 1 with streaming text-only output is fully supported.
	if (n !== undefined && n > 1 && stream && tools) {
		const functionToolsCount = tools.filter(
			(t: { type: string }) => t.type !== "web_search",
		).length;
		if (functionToolsCount > 0) {
			return c.json(
				{
					error: {
						message:
							"The `n` parameter with values greater than 1 is not supported in combination with `stream: true` and function tools. Use streaming without function tools, send a non-streaming request, or call the API multiple times.",
						type: "invalid_request_error",
						param: "n",
						code: "unsupported_parameter_combination",
					},
				},
				400,
			);
		}
	}

	// Check if messages contain images for vision capability filtering
	const hasImages = messagesContainImages(messages as BaseMessage[]);
	const hasAudio = messagesContainAudio(messages as BaseMessage[]);
	const audioFormats = hasAudio
		? getAudioFormatsFromMessages(messages as BaseMessage[])
		: [];
	const hasDocuments = messagesContainDocuments(messages as BaseMessage[]);

	// Extract web_search tool from tools array if present
	// The web_search tool is a special tool that enables native web search for providers that support it
	let webSearchTool: WebSearchTool | undefined;
	if (tools && Array.isArray(tools)) {
		const webSearchToolIndex = tools.findIndex(
			(tool: any) => tool.type === "web_search",
		);
		if (webSearchToolIndex !== -1) {
			// Cast to any to access properties since the schema allows both function and web_search tools
			const foundTool = tools[webSearchToolIndex] as any;
			webSearchTool = {
				type: "web_search",
				user_location: foundTool.user_location,
				search_context_size: foundTool.search_context_size,
				max_uses: foundTool.max_uses,
			};
			// Remove the web_search tool from the tools array so it's not sent as a regular tool
			tools.splice(webSearchToolIndex, 1);
		}
	}

	// Estimate prompt tokens once so all routing decisions can reuse the
	// same value (e.g. cache-support weighting kicks in for large prompts).
	// Uses a cheap chars/4 heuristic — accuracy is intentionally traded
	// for throughput on the gateway hot path.
	let routingPromptTokens = 0;
	if (messages && messages.length > 0) {
		routingPromptTokens = encodeChatMessages(messages);
	}
	if (tools && tools.length > 0) {
		routingPromptTokens += Math.round(JSON.stringify(tools).length / 4);
	}

	// Extract and validate source from x-source header with HTTP-Referer fallback
	let source = validateSource(
		c.req.header("x-source"),
		c.req.header("HTTP-Referer"),
	);

	// Extract User-Agent header for logging
	const userAgent = c.req.header("User-Agent") ?? undefined;

	if (!source) {
		source = detectCodingAgentFromUserAgent(userAgent);
	}

	if (source) {
		source = normalizeSourceToAgentId(source);
	}

	// If source is still unrecognized, try X-Title header
	if (!source || !isRecognizedCodingAgent(source)) {
		const fromTitle = detectCodingAgentFromTitle(
			c.req.header("X-Title") ?? c.req.header("X-OpenRouter-Title"),
		);
		if (fromTitle) {
			source = fromTitle;
		}
	}

	// If still unrecognized, try HTTP-Referer pattern matching
	if (!source || !isRecognizedCodingAgent(source)) {
		const fromReferer = detectCodingAgentFromReferer(
			c.req.header("HTTP-Referer"),
		);
		if (fromReferer) {
			source = fromReferer;
		}
	}

	// Final fallback: UA detection for unrecognized x-source values
	if (source && !isRecognizedCodingAgent(source)) {
		const detectedFromUa = detectCodingAgentFromUserAgent(userAgent);
		if (detectedFromUa) {
			source = detectedFromUa;
		}
	}

	// Check if debug mode is enabled via x-debug header
	const debugMode =
		c.req.header("x-debug") === "true" ||
		process.env.FORCE_DEBUG_MODE === "true" ||
		process.env.NODE_ENV !== "production";

	// Constants for raw data logging
	const MAX_RAW_DATA_SIZE = 1 * 1024 * 1024; // 1MB limit for raw logging data
	// Maximum buffer size for streaming responses (configurable via env var, default 50MB)
	const MAX_BUFFER_SIZE =
		(Number(process.env.MAX_STREAMING_BUFFER_MB) || 50) * 1024 * 1024;

	c.header("x-request-id", requestId);

	// Extract custom X-LLMGateway-* headers
	const customHeaders = extractCustomHeaders(c);

	// Read Responses API context from in-memory Map (set by /v1/responses proxy).
	// Uses a lookup key passed via header; actual data is never in headers.
	// External callers cannot exploit this: the key is a resp_ + shortid(24) that
	// only exists in the Map for the duration of a single app.request() call, and
	// getResponsesContext() deletes on read (one-time use).
	const responsesContextKey = c.req.header("x-responses-context-key");
	const responsesContext = responsesContextKey
		? getResponsesContext(responsesContextKey)
		: undefined;
	const syncLogInsert = responsesContext?.syncInsert ?? false;
	const logIdOverride = responsesContext?.logId;
	const finalLogId = logIdOverride ?? shortid();
	const responsesApiData: unknown = responsesContext?.responsesApiData ?? null;

	// Wrapper that injects Responses API fields into every log entry.
	// Only override the id for the final log entry (retried !== true) to avoid
	// PK conflicts when the request retries across multiple providers.
	const insertLogEntry = (logData: LogInsertData) =>
		insertLog(
			{
				...logData,
				...(logIdOverride && !logData.retried ? { id: logIdOverride } : {}),
				responsesApiData,
			},
			{ syncInsert: syncLogInsert },
		);

	// Check for X-No-Fallback header to disable provider fallback on low uptime
	const xNoFallbackHeaderSet =
		c.req.raw.headers.has("x-no-fallback") ||
		c.req.raw.headers.has("X-No-Fallback");
	const noFallback =
		c.req.raw.headers.get("x-no-fallback") === "true" ||
		c.req.raw.headers.get("X-No-Fallback") === "true";

	// Store the original llmgateway model ID for logging purposes
	const initialRequestedModel = modelInput;

	// Parse model input to resolve model, provider, and custom provider name
	const parseResult = parseModelInput(modelInput);
	const requestedModel = parseResult.requestedModel;
	const customProviderName = parseResult.customProviderName;
	const requestedRegion = parseResult.requestedRegion;

	// Count input images from messages for cost calculation
	const inputImageCount =
		requestedModel === "gemini-3-pro-image-preview" ||
		requestedModel === "gemini-3.1-flash-image-preview"
			? countInputImages(messages)
			: 0;

	// Resolve model info and filter deactivated providers
	const modelInfoResult = resolveModelInfo(
		requestedModel,
		parseResult.requestedProvider,
	);
	const useExpandedRoutingProviders =
		Boolean(modelInfoResult.requestedProvider) &&
		modelInfoResult.requestedProvider !== "llmgateway" &&
		modelInfoResult.requestedProvider !== "custom";
	const expandedActiveModelProviders = expandAllProviderRegions(
		modelInfoResult.modelInfo.providers,
	);
	const expandedAllModelProviders = expandAllProviderRegions(
		modelInfoResult.allModelProviders,
	);
	let routingExpandedModelProviders = expandedActiveModelProviders;
	let modelInfo = {
		...modelInfoResult.modelInfo,
		providers: useExpandedRoutingProviders
			? expandedActiveModelProviders
			: modelInfoResult.modelInfo.providers,
	};
	let allModelProviders = useExpandedRoutingProviders
		? expandedAllModelProviders
		: modelInfoResult.allModelProviders;
	let requestedProvider = modelInfoResult.requestedProvider;

	// If a specific region was requested (e.g. "alibaba/qwen-plus:cn-beijing"),
	// filter providers to only those matching the requested region
	if (requestedRegion) {
		const regionProviders = expandedActiveModelProviders.filter(
			(p) => p.region === requestedRegion,
		);
		modelInfo = {
			...modelInfo,
			providers: regionProviders,
		};
		allModelProviders = expandedAllModelProviders.filter(
			(p) => p.region === requestedRegion,
		);
		if (regionProviders.length === 0) {
			throw new HTTPException(400, {
				message: `Region '${requestedRegion}' is not available for model ${requestedModel}`,
			});
		}
	}

	// Validate that models requiring image input have at least one image in the request
	if (
		modelInfo.imageInputRequired &&
		!hasImages &&
		countInputImages(messages) === 0
	) {
		throw new HTTPException(400, {
			message: `Model ${requestedModel} requires at least one image input. Please include an image in your request.`,
		});
	}

	// === Early API key and organization validation for coding model restriction ===
	// We need to fetch these early to check coding model restrictions before capability checks
	const auth = c.req.header("Authorization");
	const xApiKey = c.req.header("x-api-key");

	let token: string | undefined;

	if (auth) {
		const split = auth.split("Bearer ");
		if (split.length === 2 && split[1]) {
			token = split[1];
		}
	}

	if (!token && xApiKey) {
		token = xApiKey;
	}

	if (!token) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: No API key provided. Expected 'Authorization: Bearer your-api-token' header or 'x-api-key: your-api-token' header",
		});
	}

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

	// LLM SDK: ephemeral end-user session tokens are bound to one wallet.
	// Validate expiry + load the wallet now; below we present an "effective"
	// project (forced credits mode) and organization (credits mirror the wallet
	// balance) so the existing credit-gating logic bills the wallet, while the
	// log's endCustomerWalletId redirects the worker's debit to that wallet.
	// (Shared with embeddings/moderations via apps/gateway/src/lib/end-user-session.ts.)
	const endUserWallet = (await loadEndUserWallet(apiKey)) ?? undefined;

	// Test-mode end-user wallets are funded by Stripe-sandbox top-ups, so they may
	// only spend on free models — force free-models-only auto routing for them, and
	// reject explicitly-requested paid models below once `modelInfo` is resolved.
	const effectiveFreeModelsOnly =
		free_models_only || endUserWallet?.mode === "test";

	// Get the project to determine mode for routing decisions
	let project = await findProjectById(apiKey.projectId);

	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	// Check if project is deleted (archived)
	if (project.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	// End-user sessions always bill via wallet credits through llmgateway's own
	// provider keys — never the developer's BYO keys.
	if (endUserWallet) {
		assertOriginAllowed(c, project);
		project = withCreditsMode(project);
	}

	const providerDiscountResolver = createProviderDiscountResolver(
		project.organizationId,
	);

	const buildFinalResponseMetadata = (discount?: number | null) =>
		toResponseMetadataExtras({
			logId: finalLogId,
			organizationId: project.organizationId,
			projectId: apiKey.projectId,
			discount: discount ?? null,
		});

	let configIndex = 0; // Index for round-robin environment variables

	// Filter region candidates based on available keys.
	// - credits mode: only keep regions with env keys (base key → default region only)
	// - hybrid mode: providers with a DB key keep all regions (user chose their region);
	//   providers without a DB key are filtered like credits mode
	// - api-keys mode: no filtering (all regions available, user picks via DB key)
	if (project.mode === "credits") {
		modelInfo = {
			...modelInfo,
			providers: filterRegionsByAvailableKeys(modelInfo.providers),
		};
		routingExpandedModelProviders = filterRegionsByAvailableKeys(
			routingExpandedModelProviders,
		);
		allModelProviders = filterRegionsByAvailableKeys(allModelProviders);
	} else if (project.mode === "hybrid") {
		const dbProviderKeys = await findActiveProviderKeys(project.organizationId);
		const providersWithDbKeys = new Set(dbProviderKeys.map((k) => k.provider));
		const filterHybridRegions = (
			expanded: ProviderModelMapping[],
		): ProviderModelMapping[] =>
			expanded.filter((mapping) => {
				// Providers with a DB key: keep all regions
				if (providersWithDbKeys.has(mapping.providerId)) {
					return true;
				}
				// Providers without a DB key: filter like credits mode
				if (!mapping.region) {
					return true;
				}
				const providerDef = providers.find(
					(p) => p.id === mapping.providerId,
				) as ProviderDefinition | undefined;
				if (!providerDef?.regionConfig) {
					return true;
				}
				if (mapping.region === providerDef.regionConfig.defaultRegion) {
					return true;
				}
				return hasRegionSpecificEnvKey(
					mapping.providerId as Provider,
					mapping.region,
				);
			});
		modelInfo = {
			...modelInfo,
			providers: filterHybridRegions(modelInfo.providers),
		};
		routingExpandedModelProviders = filterHybridRegions(
			routingExpandedModelProviders,
		);
		allModelProviders = filterHybridRegions(allModelProviders);
	}

	if (isRequestedServiceTier(service_tier)) {
		const serviceTierCandidateProviders = modelInfo.providers.filter(
			(mapping) => providerMatchesRequestedProvider(mapping, requestedProvider),
		);
		const serviceTierSupportedProviders = serviceTierCandidateProviders.filter(
			(mapping) =>
				mappingSupportsRequestedServiceTier(
					modelInfo.id,
					mapping,
					service_tier,
					configIndex,
				),
		);

		if (serviceTierSupportedProviders.length === 0) {
			const scopedModel =
				requestedProvider &&
				requestedProvider !== "llmgateway" &&
				requestedProvider !== "custom"
					? `${requestedProvider}/${modelInfo.id}`
					: modelInfo.id;
			const errorMessage = `Service tier '${service_tier}' is not available for model ${scopedModel}.`;

			try {
				await _insertLog(
					{
						...createLogEntry(
							requestId,
							project,
							apiKey,
							undefined,
							"",
							undefined,
							"llmgateway",
							requestedModel,
							requestedProvider,
							messages as any[],
							temperature,
							max_tokens,
							top_p,
							frequency_penalty,
							presence_penalty,
							reasoning_effort,
							reasoning_max_tokens,
							effort as "low" | "medium" | "high" | undefined,
							response_format,
							tools,
							tool_choice,
							source,
							customHeaders,
							debugMode,
							userAgent,
							image_config,
						),
						...(logIdOverride ? { id: logIdOverride } : {}),
						responsesApiData,
						content: null,
						responseSize: 0,
						finishReason: "client_error",
						promptTokens: null,
						completionTokens: null,
						totalTokens: null,
						reasoningTokens: null,
						cachedTokens: null,
						hasError: true,
						streamed: !!stream,
						canceled: false,
						errorDetails: {
							statusCode: 400,
							statusText: "Bad Request",
							responseText: JSON.stringify({
								message: errorMessage,
								service_tier,
								model: scopedModel,
							}),
							cause: "unsupported_service_tier",
						},
						duration: 0,
						timeToFirstToken: null,
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
						serviceTier: null,
						dataStorageCost: "0",
					},
					{ syncInsert: syncLogInsert },
				);
			} catch (error) {
				logger.error("Failed to log unsupported service tier rejection", {
					error: toError(error),
				});
			}

			return c.json(
				{
					error: {
						message: errorMessage,
						type: "invalid_request_error",
						param: "service_tier",
						code: "unsupported_service_tier",
					},
				},
				400,
			);
		}

		const supportsRequestedTier = (mapping: ProviderModelMapping) =>
			providerMatchesRequestedProvider(mapping, requestedProvider) &&
			mappingSupportsRequestedServiceTier(
				modelInfo.id,
				mapping,
				service_tier,
				configIndex,
			);
		modelInfo = {
			...modelInfo,
			providers: modelInfo.providers.filter(supportsRequestedTier),
		};
		routingExpandedModelProviders = routingExpandedModelProviders.filter(
			supportsRequestedTier,
		);
		allModelProviders = allModelProviders.filter(supportsRequestedTier);
	}

	// Fetch organization for coding model restriction check and credit validation
	let organization = await findOrganizationById(project.organizationId);

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

	// End-user session: present the wallet balance as the organization's credits
	// so all downstream credit-gating evaluates the wallet, not the developer's
	// org. The real organization.credits row is never touched — the worker debits
	// the wallet (see apps/gateway/src/lib/end-user-session.ts).
	if (endUserWallet) {
		organization = withWalletCredits(organization, endUserWallet);
	}

	const routingCfg = await getResolvedRoutingConfig(
		project.id,
		organization.plan,
	);

	// Sticky-session routing: when the request carries a session id and the
	// project has session stickiness enabled, provider selection is scored
	// normally and then pinned for the session via this store. The store is
	// keyed per (org, model, session); creating it lazily per model id keeps the
	// final routing decision pinned without affecting region sub-selection.
	const sessionStickyEnabled = Boolean(sessionId) && routingCfg.session.enabled;
	const createSessionStore = (modelId: string) =>
		sessionStickyEnabled && sessionId
			? createSessionProviderStore(
					project.organizationId,
					modelId,
					sessionId,
					routingCfg.session.ttlSeconds,
				)
			: undefined;

	const retryProjectContext = {
		mode: project.mode,
		organizationId: project.organizationId,
	};
	const retryOrganizationContext = {
		id: organization.id,
		credits: organization.credits,
		devPlan: organization.devPlan,
		devPlanCreditsLimit: organization.devPlanCreditsLimit,
		devPlanCreditsUsed: organization.devPlanCreditsUsed,
		devPlanPremiumCreditsUsed: organization.devPlanPremiumCreditsUsed,
		devPlanPremiumWeekStart: organization.devPlanPremiumWeekStart,
		devPlanExpiresAt: organization.devPlanExpiresAt,
		chatPlan: organization.chatPlan,
		chatPlanCreditsLimit: organization.chatPlanCreditsLimit,
		chatPlanCreditsUsed: organization.chatPlanCreditsUsed,
		chatPlanExpiresAt: organization.chatPlanExpiresAt,
	};

	// Run guardrails check for enterprise organizations
	let guardrailResult: Awaited<ReturnType<typeof checkGuardrails>> | undefined;
	if (organization.plan === "enterprise") {
		guardrailResult = await checkGuardrails({
			organizationId: project.organizationId,
			messages: messages as Parameters<typeof checkGuardrails>[0]["messages"],
		});

		if (guardrailResult.blocked) {
			// Log violations (don't let logging failures affect the request)
			for (const violation of guardrailResult.violations) {
				try {
					await logViolation(project.organizationId, violation, {
						apiKeyId: apiKey.id,
						model: requestedModel,
					});
				} catch {
					// Silently ignore logging failures
				}
			}

			const blockedViolations = guardrailResult.violations.map((v) => ({
				rule_id: v.ruleId,
				rule_name: v.ruleName,
				category: v.category,
				action: v.action,
			}));
			const blockedCategories = [
				...new Set(guardrailResult.violations.map((v) => v.category)),
			];
			const blockedRuleIds = guardrailResult.violations.map((v) => v.ruleId);
			const errorMessage =
				guardrailResult.violations.length === 1 && guardrailResult.violations[0]
					? `Request blocked by content policy: ${guardrailResult.violations[0].ruleName} (rule ${guardrailResult.violations[0].ruleId}, category ${guardrailResult.violations[0].category})`
					: `Request blocked by content policy: ${guardrailResult.violations.length} violations (categories: ${blockedCategories.join(", ")}; rules: ${blockedRuleIds.join(", ")})`;

			// Surface the block in the activity feed as a client_error so users
			// can see that the gateway rejected their request before any provider
			// was contacted.
			try {
				await insertLogEntry({
					...createLogEntry(
						requestId,
						project,
						apiKey,
						undefined,
						"",
						undefined,
						"llmgateway",
						requestedModel,
						requestedProvider,
						messages as any[],
						temperature,
						max_tokens,
						top_p,
						frequency_penalty,
						presence_penalty,
						reasoning_effort,
						reasoning_max_tokens,
						effort as "low" | "medium" | "high" | undefined,
						response_format,
						tools,
						tool_choice,
						source,
						customHeaders,
						debugMode,
						userAgent,
					),
					content: null,
					responseSize: 0,
					finishReason: "client_error",
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: true,
					streamed: !!stream,
					canceled: false,
					errorDetails: {
						statusCode: 400,
						statusText: "Bad Request",
						responseText: JSON.stringify({
							message: errorMessage,
							violations: blockedViolations,
						}),
						cause: "guardrail_violation",
					},
					duration: 0,
					timeToFirstToken: null,
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
					dataStorageCost: "0",
				});
			} catch {
				// Silently ignore logging failures
			}

			// Return the structured violation details directly. HTTPException's
			// `cause` is dropped by the global error handler, so callers would
			// otherwise only see the generic message.
			return c.json(
				{
					error: {
						message: errorMessage,
						type: "guardrail_violation",
						param: null,
						code: "content_policy_violation",
						violations: blockedViolations,
					},
				},
				400,
			);
		}

		// Apply redactions if any
		if (guardrailResult.redactions.length > 0) {
			messages = applyRedactions(
				messages as Parameters<typeof applyRedactions>[0],
				guardrailResult.redactions,
			) as typeof messages;
		}

		// Log non-blocking violations (redact/warn)
		for (const violation of guardrailResult.violations.filter(
			(v) => v.action !== "block",
		)) {
			try {
				await logViolation(project.organizationId, violation, {
					apiKeyId: apiKey.id,
					model: requestedModel,
				});
			} catch {
				// Silently ignore logging failures
			}
		}
	}

	// Dev plans are inference-only — image generation is never allowed,
	// regardless of devPlanAllowAllModels. Embeddings and video generation
	// are blocked at their respective endpoints. We check the model's
	// declared output formats (and the legacy imageGenerations provider
	// flag) so chat-completions models that emit images — e.g. Gemini
	// *-flash-image with output: ["text", "image"] — are also blocked.
	const isDevPlan = Boolean(
		organization?.isPersonal && organization.devPlan !== "none",
	);
	const modelEmitsImages =
		modelInfo.output?.includes("image") === true ||
		modelInfo.providers.some((p) => p.imageGenerations === true);
	if (isDevPlan && modelEmitsImages) {
		throw new HTTPException(403, {
			message: `Image generation is not available for coding plans. Coding plans only include text-based inference.`,
		});
	}

	// Coding plans only allow models/provider mappings with cached input pricing.
	// The model-level check denies models with no cached mapping at all.
	// The specific-provider check denies a request like `groq/gpt-oss-120b` where the
	// model qualifies as coding overall but the named mapping itself is uncached.
	const isDevPlanRestricted = Boolean(
		organization?.isPersonal &&
			organization.devPlan !== "none" &&
			!organization.devPlanAllowAllModels,
	);

	// Source restriction is gated behind DEVPASS_ENFORCE_SOURCE_RESTRICTION so it
	// can be enabled later. While disabled (default), all sources are allowed —
	// the `source` value is still normalized and recorded in logs above, so we
	// get correct x-source attribution without blocking any requests.
	const isDevPlanSourceRestricted = Boolean(
		organization?.isPersonal &&
			organization.devPlan !== "none" &&
			process.env.DEVPASS_ENFORCE_SOURCE_RESTRICTION === "true",
	);
	if (isDevPlanSourceRestricted && !isRecognizedCodingAgent(source)) {
		throw new HTTPException(403, {
			message: `DevPass coding plans are restricted to recognized coding agents. Your request was not identified as coming from a supported tool. Please ensure your coding tool sends an identifiable User-Agent header or x-source header. Supported agents: ${getSupportedAgentsList()}.`,
		});
	}

	if (isDevPlanRestricted) {
		if (!isCodingModel(modelInfo)) {
			throw new HTTPException(403, {
				message: `Model ${modelInfo.id} is not available for coding plans. Coding plans only include models optimized for coding tasks with prompt caching, tool calling, JSON output, and streaming support. You can enable access to all models in your dashboard settings at devpass.llmgateway.io/dashboard, though this may significantly increase costs due to lack of prompt caching.`,
			});
		}

		if (
			requestedProvider &&
			requestedProvider !== "llmgateway" &&
			requestedProvider !== "custom"
		) {
			throw new HTTPException(403, {
				message: `Direct provider routing is not available on coding plans. Use the root model id (e.g. \`${modelInfo.id}\`) without a provider prefix and let the gateway handle routing. You can enable access to all models in your dashboard settings at code.llmgateway.io/dashboard.`,
			});
		}

		if (requestedProvider === "custom") {
			throw new HTTPException(403, {
				message: `Custom provider routing is not available on coding plans. Use the root model id (e.g. \`${modelInfo.id}\`) without a provider prefix and let the gateway handle routing. You can enable access to all models in your dashboard settings at code.llmgateway.io/dashboard.`,
			});
		}
	}

	// Chat plan Starter tier is restricted to non-premium models. Plus and Pro
	// tiers have access to everything. This applies to all requests on a
	// personal org with chatPlan === "starter" — there's no per-request
	// "promote to regular credits" path, so an unrestricted Starter would
	// silently burn dev-plan/regular credits instead of nudging the upgrade.
	const isStarterChatPlan = Boolean(
		organization?.isPersonal && organization.chatPlan === "starter",
	);
	if (isStarterChatPlan && !isChatPlanModelAllowed("starter", modelInfo.id)) {
		throw new HTTPException(403, {
			message: `Model ${modelInfo.id} is not available on the Starter chat plan. Upgrade to Plus or Pro at chat.llmgateway.io/pricing to access frontier models.`,
		});
	}

	// Validate model capabilities (JSON output, reasoning, tools, web search, documents)
	validateModelCapabilities(modelInfo, requestedModel, requestedProvider, {
		response_format,
		reasoning_effort,
		reasoning_max_tokens,
		tools,
		tool_choice,
		webSearchTool,
		hasImages,
		hasDocuments,
	});

	let usedProvider = requestedProvider;
	// Canonical LLM Gateway model id (root id). Used for every internal
	// lookup: pricing, discount, rate-limit, IAM, key selection. Initially
	// the user's requested model; reset to `modelInfo.id` once the model is
	// resolved, and re-set on auto-route when the resolved model changes.
	let usedInternalModel: string = requestedModel;
	// Provider-specific upstream model id. Reserved for sending the request
	// to the upstream provider API — derived from the chosen provider
	// mapping after routing. Empty until routing resolves a mapping.
	let usedExternalId: string = requestedModel;
	let usedRegion: string | undefined = requestedRegion;
	let routingMetadata: RoutingMetadata | undefined;
	// The processing tier the provider actually served (Flex / Priority),
	// resolved from the upstream response — Vertex's usageMetadata.trafficType or
	// AI Studio's x-gemini-service-tier header. Billing scales token costs by
	// this served tier (not the requested one) since Google downgrades
	// unsupported tiers to standard. Null = standard / no tier.
	let servedServiceTier: "flex" | "priority" | null = null;

	// Extract retention level for data storage cost calculation
	const retentionLevel = organization?.retentionLevel ?? "none";

	// Get image size limits from environment variables or use defaults
	const freeLimitMB = Number(process.env.IMAGE_SIZE_LIMIT_FREE_MB) || 50;
	const proLimitMB = Number(process.env.IMAGE_SIZE_LIMIT_PRO_MB) || 100;

	// Determine max image size based on plan
	const userPlan = organization?.plan ?? "free";
	const maxImageSizeMB = userPlan === "pro" ? proLimitMB : freeLimitMB;

	// Validate IAM rules for model access
	// Pass modelInfo (with deactivated providers already filtered) so IAM validation
	// only considers active providers. This prevents a deny rule from being bypassed
	// when the only remaining active provider is a denied one but deactivated providers
	// are still "allowed" by the IAM rules.
	const clientIp = getClientIpFromRequest(c);
	const iamValidation = await validateRequestModelAccess(
		apiKey,
		modelInfo.id,
		requestedProvider,
		modelInfo,
		clientIp,
	);
	if (!iamValidation.allowed) {
		throwIamException(iamValidation.reason ?? "Model access denied");
	}
	// IAM allowed providers - used to filter available providers during routing
	const iamAllowedProviders = iamValidation.allowedProviders;

	// IAM-filtered model providers for routing and retry fallback paths.
	// Recomputed after auto-routing because that block replaces modelInfo.
	let iamFilteredModelProviders = iamAllowedProviders
		? modelInfo.providers.filter((p) =>
				iamAllowedProviders.includes(p.providerId),
			)
		: modelInfo.providers;
	let expandedIamFilteredModelProviders = iamAllowedProviders
		? routingExpandedModelProviders.filter((p) =>
				iamAllowedProviders.includes(p.providerId),
			)
		: routingExpandedModelProviders;

	if (isDevPlanRestricted) {
		iamFilteredModelProviders = iamFilteredModelProviders.filter(
			providerSupportsCachedInput,
		);
		expandedIamFilteredModelProviders =
			expandedIamFilteredModelProviders.filter(providerSupportsCachedInput);
		if (iamFilteredModelProviders.length === 0) {
			throw new HTTPException(403, {
				message: `No provider with cached input pricing is available for model ${modelInfo.id}. Coding plans require providers with prompt caching support; enable access to all models in your dashboard settings at code.llmgateway.io/dashboard to use this model.`,
			});
		}
	}

	// Validate the custom provider against the database if one was requested
	if (requestedProvider === "custom" && customProviderName) {
		const customProviderKey = await findCustomProviderKey(
			project.organizationId,
			customProviderName,
		);
		if (!customProviderKey) {
			throw new HTTPException(400, {
				message: `Provider '${customProviderName}' not found.`,
			});
		}
	}

	// Apply routing logic after apiKey and project are available
	if (
		(usedProvider === "llmgateway" && usedInternalModel === "auto") ||
		usedInternalModel === "auto"
	) {
		// Auto-routing and the context-window check below should react to image
		// payloads, not just text (issue #2112). Recompute the estimate with an
		// image-aware count instead of reusing the text-only routingPromptTokens.
		// requestedModel may be "auto" here, in which case no per-model image
		// table is found and the shared default per-image token count is used.
		// This is kept separate from routingPromptTokens, which stays text-only:
		// that value backs the billing-fallback usage numbers and image input is
		// priced separately via imageInputCost in costs.ts (counting images
		// there would double count).
		let estimatedInputTokens = 0;
		if (messages && messages.length > 0) {
			estimatedInputTokens = encodeChatMessages(messages, requestedModel);
		}
		if (tools && tools.length > 0) {
			estimatedInputTokens += Math.round(JSON.stringify(tools).length / 4);
		}

		// Estimate the full context needed based on the request
		let requiredContextSize = estimatedInputTokens;

		// Add max_tokens if specified
		if (max_tokens) {
			requiredContextSize += max_tokens;
		} else {
			// Add a default buffer for completion tokens if not specified
			requiredContextSize += 4096;
		}

		// Get available providers based on project mode
		let availableProviders: string[] = [];
		// Region locks from DB provider keys, so auto-routing honors an org's
		// configured region (e.g. aws_bedrock_region: "eu") instead of being
		// collapsed to the pinned default by applyPinnedDefaultRegions.
		let autoProviderLockedRegions = new Map<string, string>();

		if (project.mode === "api-keys") {
			const providerKeys = await findActiveProviderKeys(project.organizationId);
			availableProviders = providerKeys.map((key) => key.provider);
			autoProviderLockedRegions = buildProviderLockedRegions(providerKeys);
		} else if (project.mode === "credits" || project.mode === "hybrid") {
			const providerKeys = await findActiveProviderKeys(project.organizationId);
			const databaseProviders = providerKeys.map((key) => key.provider);
			autoProviderLockedRegions = buildProviderLockedRegions(providerKeys);

			// Check which providers have environment tokens available
			const envProviders: string[] = [];
			const supportedProviders = providers
				.filter((p) => p.id !== "llmgateway")
				.map((p) => p.id);
			for (const provider of supportedProviders) {
				if (hasProviderEnvironmentToken(provider as Provider)) {
					envProviders.push(provider);
				}
			}

			if (project.mode === "credits") {
				availableProviders = envProviders;
			} else {
				availableProviders = [
					...new Set([...databaseProviders, ...envProviders]),
				];
			}
		}

		// Find the cheapest model that meets our context size requirements
		// Only consider hardcoded models for auto selection
		const allowedAutoModels = [
			"claude-opus-4-6",
			"claude-sonnet-4-6",
			"claude-haiku-4-5",
		];

		let selectedModel: ModelDefinition | undefined;
		let selectedProviders: any[] = [];
		let lowestPrice = Number.MAX_VALUE;
		const now = new Date(); // Cache current time for deprecation checks

		for (const modelDef of models) {
			if (modelDef.id === "auto" || modelDef.id === "custom") {
				continue;
			}

			// Skip models that can't emit text. Auto routes chat completions, so
			// audio/video/embedding/image-only output models (e.g. tts-1) must never
			// be candidates — they fail upstream on /v1/chat/completions. This guard
			// also applies on the audio-input path below, where the allowlist check
			// is intentionally relaxed.
			const candidateOutput = (modelDef as ModelDefinition).output;
			if (candidateOutput && !candidateOutput.includes("text")) {
				continue;
			}

			// Starter chat plan can't reach blocked frontier models. Enforce it
			// during auto-selection too, otherwise an "auto" request would skip
			// the pre-routing check above and resolve to a blocked model.
			if (
				isStarterChatPlan &&
				!isChatPlanModelAllowed("starter", modelDef.id)
			) {
				continue;
			}

			// When free_models_only is true, only consider models marked as free
			// Otherwise, only consider hardcoded allowed models
			if (effectiveFreeModelsOnly) {
				if (!("free" in modelDef && modelDef.free)) {
					continue;
				}
			} else if (
				!allowedAutoModels.includes(modelDef.id) &&
				!hasAudio &&
				!hasDocuments
			) {
				continue;
			} else if (
				estimatedInputTokens > 10_000 &&
				modelDef.id === "claude-haiku-4-5"
			) {
				// Prefer Sonnet over Haiku for larger prompts once the input crosses 10k tokens
				continue;
			}

			// Validate IAM rules for this candidate model and filter providers.
			// We must re-evaluate per model because iamAllowedProviders was computed
			// for the "auto" model which only has the "llmgateway" provider.
			const candidateIam = await validateRequestModelAccess(
				apiKey,
				modelDef.id,
				undefined,
				modelDef,
				clientIp,
				{ autoRouting: true },
			);
			if (!candidateIam.allowed) {
				continue;
			}
			const candidateAllowedProviders = candidateIam.allowedProviders;

			const candidateProviders = preferConcreteRegionalMappings(
				applyPinnedDefaultRegions(
					project.mode === "credits"
						? filterRegionsByAvailableKeys(
								expandAllProviderRegions(
									modelDef.providers as ProviderModelMapping[],
								),
							)
						: expandAllProviderRegions(
								modelDef.providers as ProviderModelMapping[],
							),
					{
						explicitLocks: autoProviderLockedRegions,
						requestedRegion,
					},
				),
			);
			// Check if any of the model's providers are available
			const availableModelProviders = candidateProviders.filter(
				(provider) =>
					availableProviders.includes(provider.providerId) &&
					(!candidateAllowedProviders ||
						candidateAllowedProviders.includes(provider.providerId)),
			);

			const cachedFilteredProviders = isDevPlanRestricted
				? availableModelProviders.filter(providerSupportsCachedInput)
				: availableModelProviders;

			// Filter by context size requirement, reasoning capability, and deprecation status
			const suitableProviders = cachedFilteredProviders.filter((provider) => {
				// Skip deprecated provider mappings
				if (provider.deprecatedAt && now > provider.deprecatedAt!) {
					return false;
				}

				// Use the provider's context size, defaulting to a reasonable value if not specified
				const modelContextSize = provider.contextSize ?? 8192;
				const contextSizeMet = modelContextSize >= requiredContextSize;

				// If no_reasoning is true, exclude reasoning models
				if (no_reasoning && provider.reasoning === true) {
					return false;
				}

				// Check reasoning capability if reasoning_effort is specified.
				// "none" means "no reasoning", so it doesn't require a
				// reasoning-capable provider.
				if (
					reasoning_effort !== undefined &&
					reasoning_effort !== "none" &&
					provider.reasoning !== true
				) {
					return false;
				}

				// Check reasoning.max_tokens support if specified
				if (
					reasoning_max_tokens !== undefined &&
					provider.reasoningMaxTokens !== true
				) {
					return false;
				}

				// Check tool capability if tools or tool_choice is specified
				if (
					(tools !== undefined || tool_choice !== undefined) &&
					provider.tools !== true
				) {
					return false;
				}

				// Check web search capability if web search tool is requested
				if (webSearchTool && provider.webSearch !== true) {
					return false;
				}

				// Skip mappings that don't advertise supportsN when n > 1 so
				// auto-routing doesn't pick one and trip the post-selection
				// 400 guard. The post-guard stays as a safety net.
				if (n !== undefined && n > 1 && provider.supportsN !== true) {
					return false;
				}

				// Check JSON output capability if json_object or json_schema response format is requested
				if (
					response_format?.type === "json_object" ||
					response_format?.type === "json_schema"
				) {
					if (provider.jsonOutput !== true) {
						return false;
					}
				}

				// Check JSON schema output capability if json_schema response format is requested
				if (response_format?.type === "json_schema") {
					if (provider.jsonOutputSchema !== true) {
						return false;
					}
				}

				// Check vision capability if images are present in messages
				if (hasImages && provider.vision !== true) {
					return false;
				}

				if (hasAudio && provider.audio !== true) {
					return false;
				}

				if (
					hasAudio &&
					audioFormats.length > 0 &&
					!audioFormats.every((fmt) =>
						googleProviderSupportsAudioFormat(provider.providerId, fmt),
					)
				) {
					return false;
				}

				if (hasDocuments && provider.document !== true) {
					return false;
				}

				if (
					max_tokens !== undefined &&
					provider.maxOutput !== undefined &&
					max_tokens > provider.maxOutput
				) {
					return false;
				}

				return contextSizeMet;
			});

			if (suitableProviders.length > 0) {
				// Find the cheapest among the suitable providers for this model
				for (const provider of suitableProviders) {
					const { price } = await getDiscountedProviderSelectionPrice(
						provider,
						modelDef.id,
						{
							organizationId: project.organizationId,
							providerDiscountResolver,
						},
					);
					const totalPrice = price.toNumber();

					if (totalPrice < lowestPrice) {
						lowestPrice = totalPrice;
						selectedModel = modelDef;
						selectedProviders = suitableProviders;
					}
				}
			}
		}

		let providerAgnosticSelectedProviders = selectedProviders;

		// If we found a suitable model, use the cheapest provider from it
		if (selectedModel && selectedProviders.length > 0) {
			// Fetch uptime/latency metrics from last 5 minutes for provider selection
			const metricsCombinations = selectedProviders.map((p) => ({
				modelId: selectedModel.id,
				providerId: p.providerId,
				region: p.region,
			}));
			const metricsMap = await getProviderMetricsForRouting(
				metricsCombinations,
				routingCfg,
			);
			providerAgnosticSelectedProviders =
				await collapseProvidersToBestRegionPerProvider(
					selectedProviders,
					selectedModel,
					{
						metricsMap,
						isStreaming: stream,
						promptTokens: routingPromptTokens,
						routingConfig: routingCfg,
						organizationId: project.organizationId,
					},
				);

			const cheapestResult = await getCheapestFromAvailableProviders(
				providerAgnosticSelectedProviders,
				selectedModel,
				{
					metricsMap,
					isStreaming: stream,
					promptTokens: routingPromptTokens,
					sessionProviderStore: createSessionStore(selectedModel.id),
					routingConfig: routingCfg,
					organizationId: project.organizationId,
					providerDiscountResolver,
				},
			);

			if (cheapestResult) {
				usedProvider = cheapestResult.provider.providerId;
				usedInternalModel = selectedModel.id;
				usedExternalId = cheapestResult.provider.externalId;
				usedRegion = cheapestResult.provider.region;
				routingMetadata = {
					...cheapestResult.metadata,
					...getNoFallbackRoutingMetadata(noFallback, xNoFallbackHeaderSet),
				};
			} else {
				// Fallback to first available provider if price comparison fails
				usedProvider = selectedProviders[0].providerId;
				usedInternalModel = selectedModel.id;
				usedExternalId = selectedProviders[0].externalId;
			}
		} else {
			if (effectiveFreeModelsOnly) {
				// If free_models_only is true but no suitable model found, return error
				throw new HTTPException(400, {
					message:
						"No free models are available for auto routing. Remove free_models_only parameter or use a specific model.",
				});
			} else if (no_reasoning) {
				// If no_reasoning is true but no suitable model found, return error
				throw new HTTPException(400, {
					message:
						"No non-reasoning models are available for auto routing. Remove no_reasoning parameter or use a specific model.",
				});
			}
			// Default fallback if no suitable model is found - use cheapest allowed model
			usedInternalModel = "claude-haiku-4-5";
			usedExternalId = "claude-haiku-4-5";
			usedProvider = "anthropic";
		}
		// Update modelInfo to the selected model so retry/fallback logic can find
		// alternative providers. Without this, modelInfo still points to the "auto"
		// model definition which only has "llmgateway" as a provider, preventing retries.
		if (selectedModel) {
			modelInfo = {
				...selectedModel,
				providers: providerAgnosticSelectedProviders,
			};
		} else {
			// Fallback case: look up the default model definition
			const fallbackModelDef = models.find((m) => m.id === "claude-haiku-4-5");
			if (fallbackModelDef) {
				modelInfo = {
					...fallbackModelDef,
					providers: fallbackModelDef.providers,
				};
			}
		}
		// Clear requestedProvider so retry/fallback logic knows this was auto-routed
		requestedProvider = undefined;

		// Re-validate IAM against the resolved model so deny_providers /
		// allow_providers rules are enforced for retries and the single-provider
		// shortcut.  The original iamAllowedProviders was computed for the "auto"
		// model (which only has the "llmgateway" provider) and is not meaningful
		// for the resolved model.
		const resolvedIamValidation = await validateRequestModelAccess(
			apiKey,
			modelInfo.id,
			undefined,
			modelInfo,
			clientIp,
			{ autoRouting: true },
		);
		if (!resolvedIamValidation.allowed) {
			throwIamException(resolvedIamValidation.reason ?? "Model access denied");
		}
		const allowedProviders = resolvedIamValidation.allowedProviders;
		iamFilteredModelProviders = allowedProviders
			? modelInfo.providers.filter((p) =>
					allowedProviders.includes(p.providerId),
				)
			: modelInfo.providers;
		expandedIamFilteredModelProviders = allowedProviders
			? expandAllProviderRegions(modelInfo.providers).filter((p) =>
					allowedProviders.includes(p.providerId),
				)
			: expandAllProviderRegions(modelInfo.providers);
		if (isDevPlanRestricted) {
			iamFilteredModelProviders = iamFilteredModelProviders.filter(
				providerSupportsCachedInput,
			);
			expandedIamFilteredModelProviders =
				expandedIamFilteredModelProviders.filter(providerSupportsCachedInput);
		}
	} else if (
		(usedProvider === "llmgateway" && usedInternalModel === "custom") ||
		usedInternalModel === "custom"
	) {
		usedProvider = "llmgateway";
		usedInternalModel = "custom";
		usedExternalId = "custom";
	}

	// Wall for sandbox wallets: a test-mode end-user wallet may only spend on free
	// models. Auto routing already filtered to free models above; this rejects an
	// explicitly-requested (or custom) paid model with a pointer to the auto route.
	assertTestWalletModelAllowed(endUserWallet, modelInfo);

	// When a specific provider is requested and it has multiple mappings (for example,
	// regional variants), pick the best eligible mapping up front so the request and
	// any low-uptime fallback logic operate on the concrete provider-region pair.
	if (
		usedProvider &&
		usedProvider !== "llmgateway" &&
		usedProvider !== "custom"
	) {
		const allSameProviderMappings = modelInfo.providers.filter(
			(p) => p.providerId === usedProvider,
		);
		let sameProviderMappings = isDevPlanRestricted
			? allSameProviderMappings.filter(providerSupportsCachedInput)
			: allSameProviderMappings;
		if (isDevPlanRestricted && sameProviderMappings.length === 0) {
			throw new HTTPException(403, {
				message: `Provider ${usedProvider} does not offer cached input pricing for model ${modelInfo.id}. Coding plans require providers with prompt caching support; choose another provider or enable access to all models in your dashboard settings at code.llmgateway.io/dashboard.`,
			});
		}
		if (hasAudio) {
			sameProviderMappings = sameProviderMappings.filter(
				(p) =>
					p.audio === true &&
					(audioFormats.length === 0 ||
						audioFormats.every((fmt) =>
							googleProviderSupportsAudioFormat(p.providerId, fmt),
						)),
			);
			if (sameProviderMappings.length === 0) {
				throw new HTTPException(400, {
					message: `Provider ${usedProvider} does not support audio input for model ${modelInfo.id}.`,
				});
			}
		}
		if (hasDocuments) {
			sameProviderMappings = sameProviderMappings.filter(
				(p) => p.document === true,
			);
			if (sameProviderMappings.length === 0) {
				throw new HTTPException(400, {
					message: `Provider ${usedProvider} does not support document input for model ${modelInfo.id}.`,
				});
			}
		}
		const sameProviderRegionalMappings = sameProviderMappings.filter(
			(p) => p.region,
		);
		const sameProviderRoutingMappings =
			sameProviderRegionalMappings.length > 0
				? sameProviderRegionalMappings
				: sameProviderMappings;

		if (sameProviderMappings.length > 1) {
			let lockedRegion = usedRegion;

			if (
				!lockedRegion &&
				(project.mode === "api-keys" || project.mode === "hybrid")
			) {
				const providerKey = await findProviderKey(
					project.organizationId,
					usedProvider,
					modelInfo.id || usedInternalModel,
				);
				lockedRegion = providerKey
					? resolveExplicitRegionFromProviderKey(providerKey)
					: undefined;
			}

			const providerLockedRegions = lockedRegion
				? new Map([[usedProvider, lockedRegion]])
				: undefined;
			if (
				isDevPlanRestricted &&
				lockedRegion &&
				!sameProviderMappings.some((p) => p.region === lockedRegion)
			) {
				throw new HTTPException(403, {
					message: `Region '${lockedRegion}' for provider ${usedProvider} does not offer cached input pricing for model ${modelInfo.id}. Coding plans require providers with prompt caching support; choose another region or enable access to all models in your dashboard settings at code.llmgateway.io/dashboard.`,
				});
			}
			const eligibleMappings = filterEligibleModelProviders(
				sameProviderRoutingMappings,
				{
					allProviderVariants: modelInfo.providers,
					providerLockedRegions,
					webSearchTool,
					responseFormatType: response_format?.type,
					hasImages,
					hasAudio,
					audioFormats,
					hasDocuments,
					maxTokens: max_tokens,
					reasoningEffort: reasoning_effort,
					n,
				},
			);

			if (eligibleMappings.length > 0) {
				let selectedMapping = eligibleMappings[0];

				if (eligibleMappings.length > 1) {
					const metricsCombinations = eligibleMappings.map((provider) => ({
						modelId: modelInfo.id,
						providerId: provider.providerId,
						region: provider.region,
					}));
					const metricsMap = await getProviderMetricsForRouting(
						metricsCombinations,
						routingCfg,
					);
					const bestRegionResult = await getCheapestFromAvailableProviders(
						eligibleMappings,
						modelInfo as ModelDefinition & {
							id: string;
							output?: string[];
						},
						{
							metricsMap,
							isStreaming: stream,
							promptTokens: routingPromptTokens,
							sessionProviderStore: createSessionStore(modelInfo.id),
							routingConfig: routingCfg,
							organizationId: project.organizationId,
							providerDiscountResolver,
						},
					);

					selectedMapping = bestRegionResult?.provider ?? eligibleMappings[0];
				}

				usedInternalModel = modelInfo.id;
				usedExternalId = selectedMapping.externalId;
				usedRegion = selectedMapping.region;
			}
		} else if (sameProviderMappings.length === 1) {
			usedInternalModel = modelInfo.id;
			usedExternalId = sameProviderMappings[0].externalId;
			usedRegion ??= (sameProviderMappings[0] as ProviderModelMapping).region;
		}

		if (!usedRegion) {
			const firstRegionalMatch = sameProviderRoutingMappings.find(
				(p) => (p as ProviderModelMapping).region,
			) as ProviderModelMapping | undefined;
			if (firstRegionalMatch) {
				usedRegion = firstRegionalMatch.region;
				usedInternalModel = modelInfo.id;
				usedExternalId = firstRegionalMatch.externalId;
			}
		}
	}

	const contentFilterMode = getContentFilterMode();
	const contentFilterMethod = getContentFilterMethod();
	const shouldApplyGatewayContentFilter =
		contentFilterMode !== "disabled" &&
		shouldApplyContentFilterToModel(requestedModel);
	const keywordContentFilterMatch =
		shouldApplyGatewayContentFilter && contentFilterMethod === "keywords"
			? checkContentFilter(messages as BaseMessage[])
			: null;
	const openAIContentFilterResult =
		shouldApplyGatewayContentFilter && contentFilterMethod === "openai"
			? await checkOpenAIContentFilter(
					messages as BaseMessage[],
					{
						requestId,
						organizationId: project.organizationId,
						projectId: project.id,
						apiKeyId: apiKey.id,
					},
					c.req.raw.signal,
				)
			: null;
	const contentFilterMatched =
		keywordContentFilterMatch !== null ||
		openAIContentFilterResult?.flagged === true;
	const shouldRerouteContentFilter =
		contentFilterMode === "enabled" && contentFilterMatched;
	let contentFilterRoutingExcludedProviders: ProviderModelMapping[] = [];
	let contentFilterRoutingApplied = false;

	// Check provider RPM caps for specifically requested providers
	// If rate-limited, route to an alternative (or 429 if no-fallback)
	if (
		usedProvider &&
		requestedProvider &&
		requestedProvider !== "llmgateway" &&
		requestedProvider !== "custom"
	) {
		const baseModelId = (modelInfo as ModelDefinition).id;
		const rateLimitPeek = await peekProviderRateLimit(
			project.organizationId,
			usedProvider,
			baseModelId,
		);

		if (rateLimitPeek.rateLimited) {
			if (noFallback) {
				const blockedLimits = rateLimitPeek.blockedBy
					.map(
						(window) =>
							`${rateLimitPeek.limits[window].limit} ${providerRateLimitWindows[window].label}`,
					)
					.join(" and ");

				throw new HTTPException(429, {
					message: `Rate limit exceeded: maximum ${blockedLimits} for ${requestedProvider}/${baseModelId}. Please try again later.`,
				});
			}

			// Attempt to re-route to alternative providers (same pattern as low-uptime fallback)
			const providerIds = modelInfo.providers
				.filter(
					(p) => !(p.providerId === usedProvider && p.region === usedRegion),
				)
				.map((p) => p.providerId);

			if (providerIds.length > 0) {
				const providerKeys = await findProviderKeysByProviders(
					project.organizationId,
					providerIds,
				);

				const availableProviders =
					project.mode === "api-keys"
						? providerKeys.map((key) => key.provider)
						: providers
								.filter((p) => p.id !== "llmgateway" && p.id !== usedProvider)
								.filter((p) => hasProviderEnvironmentToken(p.id as Provider))
								.map((p) => p.id);

				const availableModelProviders = preferConcreteRegionalMappings(
					applyPinnedDefaultRegions(iamFilteredModelProviders, {
						explicitLocks: buildProviderLockedRegions(providerKeys),
						requestedRegion,
					}),
				).filter((provider) => {
					if (!availableProviders.includes(provider.providerId)) {
						return false;
					}
					if (
						provider.providerId === usedProvider &&
						provider.region === usedRegion
					) {
						return false;
					}
					if (webSearchTool && provider.webSearch !== true) {
						return false;
					}
					if (
						response_format?.type === "json_object" ||
						response_format?.type === "json_schema"
					) {
						if (provider.jsonOutput !== true) {
							return false;
						}
					}
					if (response_format?.type === "json_schema") {
						if (provider.jsonOutputSchema !== true) {
							return false;
						}
					}
					if (hasImages && provider.vision !== true) {
						return false;
					}
					if (hasAudio && provider.audio !== true) {
						return false;
					}
					if (
						hasAudio &&
						audioFormats.length > 0 &&
						!audioFormats.every((fmt) =>
							googleProviderSupportsAudioFormat(provider.providerId, fmt),
						)
					) {
						return false;
					}
					if (hasDocuments && provider.document !== true) {
						return false;
					}
					return true;
				});

				const candidatesForRouting = await pickNonRateLimitedCandidates(
					project.organizationId,
					baseModelId,
					availableModelProviders,
				);

				if (candidatesForRouting.length > 0) {
					const rawModelForFallback = models.find((m) => m.id === baseModelId);
					const modelWithPricing = rawModelForFallback
						? {
								...rawModelForFallback,
								providers: expandAllProviderRegions(
									rawModelForFallback.providers as ProviderModelMapping[],
								),
							}
						: undefined;

					if (modelWithPricing) {
						const metricsCombinations = candidatesForRouting.map((p) => ({
							modelId: modelWithPricing.id,
							providerId: p.providerId,
							region: p.region,
						}));
						const allMetricsMap = await getProviderMetricsForRouting(
							metricsCombinations,
							routingCfg,
						);

						const cheapestResult = await getCheapestFromAvailableProviders(
							candidatesForRouting,
							modelWithPricing,
							{
								metricsMap: allMetricsMap,
								isStreaming: stream,
								promptTokens: routingPromptTokens,
								sessionProviderStore: createSessionStore(modelWithPricing.id),
								routingConfig: routingCfg,
								organizationId: project.organizationId,
								providerDiscountResolver,
							},
						);

						const originalProviderInfo = modelInfo.providers.find(
							(p) => p.providerId === requestedProvider,
						);
						const {
							price: originalProviderPrice,
							discount: originalProviderDiscount,
						} = await getDiscountedProviderSelectionPrice(
							originalProviderInfo,
							modelWithPricing.id,
							{
								organizationId: project.organizationId,
								providerDiscountResolver,
							},
						);

						const originalProviderScore = {
							providerId: requestedProvider,
							score: -1,
							price: originalProviderPrice.toNumber(),
							discount: originalProviderDiscount.toNumber(),
							rate_limited: true as const,
						};

						if (cheapestResult) {
							usedProvider = cheapestResult.provider.providerId;
							usedInternalModel = modelInfo.id;
							usedExternalId = cheapestResult.provider.externalId;
							usedRegion = cheapestResult.provider.region;
							routingMetadata = {
								...cheapestResult.metadata,
								selectionReason: "rate-limit-fallback",
								originalProvider: requestedProvider,
								originalProviderRateLimited: true,
								providerScores: [
									originalProviderScore,
									...cheapestResult.metadata.providerScores,
								],
								...getNoFallbackRoutingMetadata(
									noFallback,
									xNoFallbackHeaderSet,
								),
							};
						}
					}
				}
			}
			// If no alternative providers available, continue with the rate-limited one (fail-open)
		}
	}

	// Check uptime for specifically requested providers (not llmgateway or custom)
	// If uptime is below 80%, route to an alternative provider instead
	// Skip this fallback if X-No-Fallback header is set
	if (
		!noFallback &&
		usedProvider &&
		requestedProvider &&
		requestedProvider !== "llmgateway" &&
		requestedProvider !== "custom"
	) {
		// Find the base model ID for metrics lookup
		// Since custom providers are excluded above, modelInfo always has 'id'
		const baseModelId = (modelInfo as ModelDefinition).id;

		// Fetch uptime metrics for the requested provider
		const metricsMap = await getProviderMetricsForRouting(
			[
				{
					modelId: baseModelId,
					providerId: usedProvider,
					region: usedRegion,
				},
			],
			routingCfg,
		);

		const metrics = metricsMap.get(
			metricsKey(baseModelId, usedProvider, usedRegion),
		);

		// If we have metrics and uptime is below the configured threshold, route to an alternative
		if (
			metrics &&
			metrics.uptime !== undefined &&
			metrics.uptime < routingCfg.retry.lowUptimeFallbackThreshold
		) {
			const currentUptime = metrics.uptime;
			// Get available providers for routing
			const providerIds = modelInfo.providers
				.filter(
					(p) => !(p.providerId === usedProvider && p.region === usedRegion),
				) // Exclude the exact low-uptime provider+region pair
				.map((p) => p.providerId);

			if (providerIds.length > 0) {
				const providerKeys = await findProviderKeysByProviders(
					project.organizationId,
					providerIds,
				);

				const availableProviders =
					project.mode === "api-keys"
						? providerKeys.map((key) => key.provider)
						: providers
								.filter((p) => p.id !== "llmgateway" && p.id !== usedProvider)
								.filter((p) => hasProviderEnvironmentToken(p.id as Provider))
								.map((p) => p.id);

				// Filter model providers to only those available (excluding the low-uptime one)
				// If web search is requested, also filter to providers that support it
				// If JSON output is requested, also filter to providers that support it
				const availableModelProviders = filterEligibleModelProviders(
					preferConcreteRegionalMappings(
						applyPinnedDefaultRegions(expandedIamFilteredModelProviders, {
							explicitLocks: buildProviderLockedRegions(providerKeys),
							requestedRegion,
						}),
					),
					{
						allProviderVariants: modelInfo.providers,
						availableProviders,
						webSearchTool,
						responseFormatType: response_format?.type,
						hasImages,
						hasAudio,
						audioFormats,
						hasDocuments,
						maxTokens: max_tokens,
						reasoningEffort: reasoning_effort,
						n,
					},
				).filter(
					(provider) =>
						!(
							provider.providerId === usedProvider &&
							provider.region === usedRegion
						),
				);

				const uptimeFallbackCandidates = await pickNonRateLimitedCandidates(
					project.organizationId,
					baseModelId,
					availableModelProviders,
				);

				if (uptimeFallbackCandidates.length > 0) {
					const rawModelForFallback = models.find((m) => m.id === baseModelId);
					const modelWithPricing = rawModelForFallback
						? {
								...rawModelForFallback,
								providers: expandAllProviderRegions(
									rawModelForFallback.providers as ProviderModelMapping[],
								),
							}
						: undefined;

					if (modelWithPricing) {
						// Fetch metrics for all available providers
						const metricsCombinations = uptimeFallbackCandidates.map((p) => ({
							modelId: modelWithPricing.id,
							providerId: p.providerId,
							region: p.region,
						}));
						const allMetricsMap = await getProviderMetricsForRouting(
							metricsCombinations,
							routingCfg,
						);
						const providerAgnosticCandidates =
							await collapseProvidersToBestRegionPerProvider(
								uptimeFallbackCandidates,
								modelWithPricing,
								{
									metricsMap: allMetricsMap,
									isStreaming: stream,
									promptTokens: routingPromptTokens,
									routingConfig: routingCfg,
									organizationId: project.organizationId,
								},
							);

						// Filter to only providers with better uptime than the original
						// to avoid falling back to worse providers
						const betterUptimeProviders = providerAgnosticCandidates.filter(
							(p) => {
								const providerMetrics = allMetricsMap.get(
									metricsKey(modelWithPricing.id, p.providerId, p.region),
								);
								// If no metrics, assume the provider is healthy (100% uptime)
								// If has metrics, only include if uptime is better than original
								return (
									!providerMetrics ||
									(providerMetrics.uptime ?? 100) > currentUptime
								);
							},
						);

						// Only proceed with fallback if there are providers with better uptime
						// Otherwise stick with the original provider
						if (betterUptimeProviders.length > 0) {
							const cheapestResult = await getCheapestFromAvailableProviders(
								betterUptimeProviders,
								modelWithPricing,
								{
									metricsMap: allMetricsMap,
									isStreaming: stream,
									promptTokens: routingPromptTokens,
									sessionProviderStore: createSessionStore(modelWithPricing.id),
									routingConfig: routingCfg,
									organizationId: project.organizationId,
									providerDiscountResolver,
								},
							);

							// Get price info for the original requested provider to include in scores
							const originalProviderInfo = modelInfo.providers.find(
								(p) => p.providerId === requestedProvider,
							);
							const {
								price: originalProviderPrice,
								discount: originalProviderDiscount,
							} = await getDiscountedProviderSelectionPrice(
								originalProviderInfo,
								modelWithPricing.id,
								{
									organizationId: project.organizationId,
									providerDiscountResolver,
								},
							);

							// Create score entry for the original requested provider
							const originalProviderScore = {
								providerId: requestedProvider,
								score: -1, // Negative score indicates this provider was skipped due to low uptime
								price: originalProviderPrice.toNumber(),
								discount: originalProviderDiscount.toNumber(),
								uptime: currentUptime,
								latency: metrics.averageLatency,
								throughput: metrics.throughput,
							};

							if (cheapestResult) {
								usedProvider = cheapestResult.provider.providerId;
								usedInternalModel = modelInfo.id;
								usedExternalId = cheapestResult.provider.externalId;
								usedRegion = cheapestResult.provider.region;
								routingMetadata = {
									...cheapestResult.metadata,
									selectionReason: "low-uptime-fallback",
									originalProvider: requestedProvider,
									originalProviderUptime: currentUptime,
									// Add the original provider's score to the scores array
									providerScores: [
										originalProviderScore,
										...cheapestResult.metadata.providerScores,
									],
									...getNoFallbackRoutingMetadata(
										noFallback,
										xNoFallbackHeaderSet,
									),
								};
							}
						}
					}
				}
			}
			// If no alternative providers available, continue with the requested one
		}
	}

	if (!usedProvider) {
		if (iamFilteredModelProviders.length === 0) {
			throw new HTTPException(403, {
				message: `Access denied: No providers are allowed for model ${modelInfo.id} after applying IAM rules. All active providers for this model are denied by your API key's IAM configuration.`,
			});
		}

		if (iamFilteredModelProviders.length === 1) {
			usedProvider = iamFilteredModelProviders[0].providerId;
			usedInternalModel = modelInfo.id;
			usedExternalId = iamFilteredModelProviders[0].externalId;
			usedRegion = iamFilteredModelProviders[0].region;
		} else {
			const providerIds = iamFilteredModelProviders.map((p) => p.providerId);
			const providerKeys = await findProviderKeysByProviders(
				project.organizationId,
				providerIds,
			);

			const availableProviders =
				project.mode === "api-keys"
					? providerKeys.map((key) => key.provider)
					: providers
							.filter((p) => p.id !== "llmgateway")
							.filter((p) => hasProviderEnvironmentToken(p.id as Provider))
							.map((p) => p.id);

			// Build a map of provider → locked region from DB provider keys.
			// When a user sets a region in their provider key (e.g. alibaba_region: "cn-beijing"),
			// only that region should be a candidate — not all expanded regions.
			const providerLockedRegions = buildProviderLockedRegions(providerKeys);

			// Filter model providers to only those eligible for this request
			const availableModelProviders = filterEligibleModelProviders(
				preferConcreteRegionalMappings(
					applyPinnedDefaultRegions(expandedIamFilteredModelProviders, {
						explicitLocks: providerLockedRegions,
						requestedRegion,
					}),
				),
				{
					allProviderVariants: modelInfo.providers,
					availableProviders,
					providerLockedRegions,
					webSearchTool,
					responseFormatType: response_format?.type,
					hasImages,
					hasAudio,
					audioFormats,
					hasDocuments,
					maxTokens: max_tokens,
					reasoningEffort: reasoning_effort,
					n,
				},
			);

			if (availableModelProviders.length === 0) {
				const audience =
					project.mode === "api-keys" ? "configured" : "available";
				throw new HTTPException(400, {
					message: hasAudio
						? `No provider with audio support is available for model ${usedInternalModel}. The request contains audio but none of the ${audience} providers support audio input.`
						: hasImages
							? `No provider with vision support is available for model ${usedInternalModel}. The request contains images but none of the ${audience} providers support vision.`
							: project.mode === "api-keys"
								? `No provider key set for any of the providers that support model ${usedInternalModel}. Please add the provider key in the settings or switch the project mode to credits or hybrid.`
								: `No available provider could be found for model ${usedInternalModel}`,
				});
			}

			const contentFilterRoutingDecision = getContentFilterRoutingDecision(
				availableModelProviders,
				shouldRerouteContentFilter,
			);
			const contentFilterPreferredProviders =
				contentFilterRoutingDecision.candidates;
			contentFilterRoutingExcludedProviders =
				contentFilterRoutingDecision.excludedProviders;
			contentFilterRoutingApplied = contentFilterRoutingDecision.rerouted;

			// Filter out rate-limited providers during routing
			const rateLimitedProviderIds = await filterRateLimitedProviders(
				project.organizationId,
				contentFilterPreferredProviders.map((p) => ({
					providerId: p.providerId,
					model: (modelInfo as ModelDefinition).id,
				})),
			);
			const nonRateLimitedProviders = contentFilterPreferredProviders.filter(
				(p) => !rateLimitedProviderIds.has(p.providerId),
			);
			// Fail-open: if all are rate-limited, use them all anyway
			const routingCandidates =
				nonRateLimitedProviders.length > 0
					? nonRateLimitedProviders
					: contentFilterPreferredProviders;

			const rawModelWithPricing = models.find(
				(m) => m.id === usedInternalModel,
			);
			const modelWithPricing = rawModelWithPricing
				? {
						...rawModelWithPricing,
						providers: expandAllProviderRegions(
							rawModelWithPricing.providers as ProviderModelMapping[],
						),
					}
				: undefined;

			if (modelWithPricing) {
				// Fetch uptime/latency metrics from last 5 minutes for provider selection
				const metricsCombinations = [
					...routingCandidates,
					...contentFilterRoutingExcludedProviders,
				].map((provider) => ({
					modelId: modelWithPricing.id,
					providerId: provider.providerId,
					region: provider.region,
				}));
				const metricsMap = await getProviderMetricsForRouting(
					metricsCombinations,
					routingCfg,
				);
				const providerAgnosticCandidates =
					await collapseProvidersToBestRegionPerProvider(
						routingCandidates,
						modelWithPricing,
						{
							metricsMap,
							isStreaming: stream,
							promptTokens: routingPromptTokens,
							routingConfig: routingCfg,
							organizationId: project.organizationId,
						},
					);

				const cheapestResult = await getCheapestFromAvailableProviders(
					providerAgnosticCandidates,
					modelWithPricing,
					{
						metricsMap,
						isStreaming: stream,
						promptTokens: routingPromptTokens,
						sessionProviderStore: createSessionStore(modelWithPricing.id),
						routingConfig: routingCfg,
						organizationId: project.organizationId,
						providerDiscountResolver,
					},
				);

				if (cheapestResult) {
					// Apply provider preference hysteresis to reduce unnecessary switching.
					// Skip for exploration requests — they exist to refresh per-provider
					// metrics — and for sticky sessions, which already pin the provider
					// per-session via the session store inside provider selection.
					let selectedProvider = cheapestResult.provider;
					let hysteresisSelectionReason =
						cheapestResult.metadata.selectionReason;

					if (
						hysteresisSelectionReason !== "random-exploration" &&
						routingCfg.sticky.enabled &&
						!sessionStickyEnabled
					) {
						const preferred = await getPreferredProvider(
							project.organizationId,
							modelWithPricing.id,
						);

						if (preferred) {
							const stableCandidate = resolvePreferredProvider(
								preferred,
								providerAgnosticCandidates,
								cheapestResult.metadata.providerScores,
								routingCfg.sticky,
							);
							if (stableCandidate) {
								selectedProvider = stableCandidate;
								hysteresisSelectionReason = "stable-preferred";
							} else {
								void setPreferredProvider(
									project.organizationId,
									modelWithPricing.id,
									cheapestResult.provider.providerId,
									cheapestResult.provider.region,
									routingCfg.sticky,
								);
							}
						} else {
							void setPreferredProvider(
								project.organizationId,
								modelWithPricing.id,
								cheapestResult.provider.providerId,
								cheapestResult.provider.region,
								routingCfg.sticky,
							);
						}
					}

					usedProvider = selectedProvider.providerId;
					usedInternalModel = modelWithPricing.id;
					usedExternalId = selectedProvider.externalId;
					usedRegion = selectedProvider.region;
					routingMetadata = await addContentFilterRoutingMetadata(
						{
							...cheapestResult.metadata,
							selectedProvider: usedProvider,
							selectionReason: hysteresisSelectionReason,
							...getNoFallbackRoutingMetadata(noFallback, xNoFallbackHeaderSet),
						},
						contentFilterMatched,
						contentFilterRoutingExcludedProviders,
						modelWithPricing.id,
						metricsMap,
						project.organizationId,
						providerDiscountResolver,
					);
					// Annotate rate-limited providers in routing metadata
					if (rateLimitedProviderIds.size > 0) {
						// Add filtered-out rate-limited providers as score entries
						for (const rlProviderId of rateLimitedProviderIds) {
							const existing = routingMetadata.providerScores.find(
								(s) => s.providerId === rlProviderId,
							);
							if (existing) {
								existing.rate_limited = true;
							} else {
								const providerInfo = modelInfo.providers.find(
									(p) => p.providerId === rlProviderId,
								);
								const { price, discount } =
									await getDiscountedProviderSelectionPrice(
										providerInfo,
										modelWithPricing.id,
										{
											organizationId: project.organizationId,
											providerDiscountResolver,
										},
									);
								routingMetadata.providerScores.push({
									providerId: rlProviderId,
									score: -1,
									price: price.toNumber(),
									discount: discount.toNumber(),
									rate_limited: true,
								});
							}
						}
					}
				} else {
					usedProvider = routingCandidates[0].providerId;
					usedInternalModel = modelInfo.id;
					usedExternalId = routingCandidates[0].externalId;
					usedRegion = routingCandidates[0].region;
				}
			} else {
				usedProvider = contentFilterPreferredProviders[0].providerId;
				usedInternalModel = modelInfo.id;
				usedExternalId = contentFilterPreferredProviders[0].externalId;
				usedRegion = contentFilterPreferredProviders[0].region;
			}
		}
	}

	if (!usedProvider) {
		throw new HTTPException(500, {
			message: "An error occurred while routing the request",
		});
	}

	// Set routing metadata for direct provider selection (when routing was skipped)
	if (!routingMetadata && usedProvider && usedProvider !== "llmgateway") {
		// Determine the selection reason based on how the provider was selected
		let selectionReason: string;
		if (requestedProvider && requestedProvider !== "llmgateway") {
			selectionReason = "direct-provider-specified";
		} else if (modelInfo.providers.length === 1) {
			selectionReason = "single-provider-available";
		} else {
			selectionReason = "fallback-first-available";
		}

		let routingMetadataProviders = allModelProviders;
		let directProviderRegionWasExplicit = false;

		if (
			selectionReason === "direct-provider-specified" &&
			requestedProvider &&
			requestedProvider !== "custom"
		) {
			let explicitDirectRegion = requestedRegion;
			if (
				!explicitDirectRegion &&
				(project.mode === "api-keys" || project.mode === "hybrid")
			) {
				const providerKey = await findProviderKey(
					project.organizationId,
					requestedProvider,
					modelInfo.id || usedInternalModel,
				);
				explicitDirectRegion = providerKey
					? resolveExplicitRegionFromProviderKey(providerKey)
					: undefined;
			}

			directProviderRegionWasExplicit = Boolean(explicitDirectRegion);
			const providerLockedRegions = explicitDirectRegion
				? new Map([[requestedProvider, explicitDirectRegion]])
				: undefined;
			const directProviderMappings = applyPinnedDefaultRegions(
				allModelProviders.filter(
					(provider) => provider.providerId === requestedProvider,
				),
				{ explicitLocks: providerLockedRegions, requestedRegion },
			);
			const directProviderRegionalMappings = directProviderMappings.filter(
				(provider) => provider.region,
			);
			routingMetadataProviders = filterEligibleModelProviders(
				directProviderRegionalMappings.length > 0
					? directProviderRegionalMappings
					: directProviderMappings,
				{
					allProviderVariants: modelInfo.providers,
					providerLockedRegions,
					webSearchTool,
					responseFormatType: response_format?.type,
					hasImages,
					hasAudio,
					audioFormats,
					hasDocuments,
					maxTokens: max_tokens,
					reasoningEffort: reasoning_effort,
					n,
				},
			);

			if (directProviderRegionWasExplicit) {
				const selectedDirectProvider =
					routingMetadataProviders.find(
						(provider) =>
							provider.providerId === usedProvider &&
							provider.region === usedRegion,
					) ??
					routingMetadataProviders.find(
						(provider) => provider.providerId === usedProvider,
					);

				routingMetadataProviders = selectedDirectProvider
					? [selectedDirectProvider]
					: [];
			}
		}

		// Fetch metrics for all eligible providers to include in routing metadata
		const baseModelId = (modelInfo as ModelDefinition).id;
		let metricsMap: Map<string, ProviderMetrics> = new Map();

		if (baseModelId && usedProvider !== "custom") {
			const metricsCombinations = [
				...routingMetadataProviders,
				...contentFilterRoutingExcludedProviders,
			].map((provider) => ({
				modelId: baseModelId,
				providerId: provider.providerId,
				region: provider.region,
			}));
			metricsMap = await getProviderMetricsForRouting(
				metricsCombinations,
				routingCfg,
			);
		}

		const weightedScores =
			selectionReason === "direct-provider-specified" &&
			directProviderRegionWasExplicit
				? null
				: await getCheapestFromAvailableProviders(
						routingMetadataProviders,
						modelInfo as ModelDefinition & {
							id: string;
							output?: string[];
						},
						{
							// No session store here: this call only computes scores for
							// routing metadata and must not re-pin the session.
							metricsMap,
							isStreaming: stream,
							promptTokens: routingPromptTokens,
							routingConfig: routingCfg,
							organizationId: project.organizationId,
							providerDiscountResolver,
						},
					);

		const allProviderScores =
			weightedScores?.metadata.providerScores ??
			(await Promise.all(
				routingMetadataProviders.map(async (p) => {
					const metrics = metricsMap.get(
						metricsKey(baseModelId, p.providerId, p.region),
					);
					const { price, discount } = await getDiscountedProviderSelectionPrice(
						p,
						baseModelId,
						{
							organizationId: project.organizationId,
							providerDiscountResolver,
						},
					);

					return {
						providerId: p.providerId,
						region: p.region,
						score:
							selectionReason === "direct-provider-specified" &&
							directProviderRegionWasExplicit
								? 1
								: 0,
						price: price.toNumber(),
						discount: discount.toNumber(),
						uptime: metrics?.uptime ?? 0,
						latency: metrics?.averageLatency ?? 0,
						throughput: metrics?.throughput ?? 0,
					};
				}),
			));

		routingMetadata = await addContentFilterRoutingMetadata(
			{
				availableProviders: routingMetadataProviders.map((p) => p.providerId),
				selectedProvider: usedProvider,
				selectionReason,
				providerScores: allProviderScores,
				...getNoFallbackRoutingMetadata(noFallback, xNoFallbackHeaderSet),
			},
			contentFilterMatched,
			contentFilterRoutingExcludedProviders,
			baseModelId,
			metricsMap,
			project.organizationId,
			providerDiscountResolver,
		);
	}

	// Re-resolve the model definition for the routed provider so we have the
	// expanded providers list (regions flattened) downstream.
	let finalModelInfo: ModelDefinition | undefined;

	if (usedProvider === "custom") {
		finalModelInfo = {
			id: usedInternalModel,
			family: "custom",
			providers: [
				{
					providerId: "custom" as const,
					externalId: usedExternalId,
					inputPrice: "0",
					outputPrice: "0",
					// Custom providers have no catalog entry, so the gateway cannot
					// know their limits (contextSize, maxOutput) or capabilities
					// (vision, jsonOutput, ...). Leave them unset rather than
					// guessing — capability validation is skipped for custom
					// providers and the upstream provider enforces its own limits.
					// `streaming` is required by the type but is never read for
					// custom providers (streaming support comes from the catalog).
					streaming: true,
				},
			],
		};
	} else {
		const rawFinalModelInfo = models.find(
			(m) =>
				m.id === usedInternalModel &&
				m.providers.some((p) => p.providerId === usedProvider),
		);
		if (rawFinalModelInfo) {
			finalModelInfo = {
				...rawFinalModelInfo,
				providers: expandAllProviderRegions(rawFinalModelInfo.providers),
			};
		}
	}

	// Check if this is an image generation model. Identify the routed mapping
	// by (providerId, region) — externalId is upstream-only and no longer
	// participates in mapping selection.
	const imageGenProviderMapping = finalModelInfo?.providers.find(
		(p) =>
			p.providerId === usedProvider &&
			(p.region ?? null) === (usedRegion ?? null),
	);
	let isImageGeneration = imageGenProviderMapping?.imageGenerations === true;

	// `usedModelMapping` is the log column that stores the upstream model id.
	let usedModelMapping = usedExternalId;
	let usedModelFormatted = formatUsedModelForDisplay(
		usedProvider,
		usedInternalModel,
		customProviderName,
		usedRegion,
	); // Store in LLMGateway format

	// Auto-set reasoning_effort for auto-routing when model supports reasoning
	// Skip when web_search tool is present since it's incompatible with "minimal" reasoning effort
	if (
		requestedModel === "auto" &&
		reasoning_effort === undefined &&
		finalModelInfo &&
		!webSearchTool
	) {
		// Check if the selected model supports reasoning
		const selectedModelSupportsReasoning = finalModelInfo.providers.some(
			(provider) => provider.reasoning === true,
		);

		if (selectedModelSupportsReasoning) {
			// Set reasoning_effort to "minimal" for gpt-5* models, "low" for others
			if (usedInternalModel.startsWith("gpt-5")) {
				reasoning_effort = "minimal";
			} else {
				reasoning_effort = "low";
			}
		}
	}

	let url: string | undefined;

	// Get the provider key for the selected provider based on project mode

	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;
	let usedApiKeyHash: string | undefined;
	let envVarName: string | undefined; // Environment variable name for health tracking
	// ID for tracked-key health attribution. Equal to providerKey.id when the
	// DB-provided key is what's actually sent. Cleared when a region-specific
	// env var override replaces the token, so health failures route to the env
	// credential via envVarName instead of blaming an unused DB key. Endpoint
	// and option resolution still use providerKey for BYOK base URLs/options.
	let trackedKeyHealthId: string | undefined;
	if (
		project.mode === "credits" &&
		(usedProvider === "custom" || usedProvider === "llmgateway")
	) {
		throw new HTTPException(400, {
			message:
				"Custom providers are not supported in credits mode. Please change your project settings to API keys or hybrid mode.",
		});
	}

	if (project.mode === "api-keys") {
		// Get the provider key from the database using cached helper function
		if (usedProvider === "custom" && customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				customProviderName,
				usedInternalModel,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				usedInternalModel,
			);
		}

		if (!providerKey) {
			const providerDisplayName =
				usedProvider === "custom" && customProviderName
					? customProviderName
					: usedProvider;
			throw new HTTPException(400, {
				message: `No API key set for provider: ${providerDisplayName}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
			});
		}

		usedToken = providerKey.token;
		trackedKeyHealthId = providerKey.id;
		if (
			modelHasRegionalMappingsForProvider(
				finalModelInfo ?? modelInfo,
				usedProvider,
			)
		) {
			usedRegion ??= resolveRegionFromProviderKey(providerKey);
		}
		// Override with region-specific env var if the DB key doesn't match the requested region.
		// When we do override, route health attribution to the regional env credential.
		// providerKey stays set so endpoint/options/baseUrl construction keeps the BYOK context;
		// only trackedKeyHealthId is cleared so reportTrackedKey* doesn't blame the unused DB key.
		if (usedRegion) {
			const regionEnvVarName = getRegionSpecificEnvVarName(
				usedProvider,
				usedRegion,
			);
			if (regionEnvVarName) {
				const regionToken = process.env[regionEnvVarName];
				if (regionToken && regionToken !== usedToken) {
					usedToken = regionToken;
					envVarName = regionEnvVarName;
					configIndex = 0;
					trackedKeyHealthId = undefined;
				}
			}
		}
	} else if (project.mode === "credits") {
		// Check regular credits, dev plan credits, and chat plan credits.
		assertDevPlanPremiumCapNotExceeded(
			organization,
			(finalModelInfo ?? modelInfo) as ModelDefinition,
		);
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

		// We trust the bare `modelInfo.free` flag here: free models are always
		// marked explicitly in the catalog, so a `free: true` model is intended
		// to be usable without credits. Do not switch this to isModelTrulyFree.
		if (
			totalAvailableCredits <= 0 &&
			!((finalModelInfo ?? modelInfo) as ModelDefinition).free
		) {
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

		if (usedProvider === "llmgateway") {
			throw new HTTPException(400, {
				message:
					"Custom models require a provider key configured in your organization settings.",
			});
		}

		const envResult = getProviderEnv(usedProvider, {
			selectionScope: usedInternalModel,
		});
		usedToken = envResult.token;
		configIndex = envResult.configIndex;
		envVarName = envResult.envVarName;

		// Override with region-specific env var if a non-default region is selected.
		// Health attribution must follow the credential we actually send.
		if (usedRegion) {
			const regionEnvVarName = getRegionSpecificEnvVarName(
				usedProvider,
				usedRegion,
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
	} else if (project.mode === "hybrid") {
		// First try to get the provider key from the database
		if (usedProvider === "custom" && customProviderName) {
			providerKey = await findCustomProviderKey(
				project.organizationId,
				customProviderName,
				usedInternalModel,
			);
		} else {
			providerKey = await findProviderKey(
				project.organizationId,
				usedProvider,
				usedInternalModel,
			);
		}

		if (providerKey) {
			usedToken = providerKey.token;
			trackedKeyHealthId = providerKey.id;
			if (
				modelHasRegionalMappingsForProvider(
					finalModelInfo ?? modelInfo,
					usedProvider,
				)
			) {
				usedRegion ??= resolveRegionFromProviderKey(providerKey);
			}
			// Override with region-specific env var if the DB key doesn't match the requested region.
			// Route health attribution to the env credential while keeping providerKey for
			// endpoint/options resolution (BYOK base URLs and provider options).
			if (usedRegion) {
				const regionEnvVarName = getRegionSpecificEnvVarName(
					usedProvider,
					usedRegion,
				);
				if (regionEnvVarName) {
					const regionToken = process.env[regionEnvVarName];
					if (regionToken && regionToken !== usedToken) {
						usedToken = regionToken;
						envVarName = regionEnvVarName;
						configIndex = 0;
						trackedKeyHealthId = undefined;
					}
				}
			}
		} else {
			// No API key available, fall back to credits
			// Check regular credits, dev plan credits, and chat plan credits.
			assertDevPlanPremiumCapNotExceeded(
				organization,
				(finalModelInfo ?? modelInfo) as ModelDefinition,
			);
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

			if (
				totalAvailableCredits <= 0 &&
				!isModelTrulyFree((finalModelInfo ?? modelInfo) as ModelDefinition)
			) {
				if (
					organization.chatPlan !== "none" &&
					chatPlanCreditsRemaining <= 0 &&
					devPlanCreditsRemaining <= 0
				) {
					const renewalDate = organization.chatPlanExpiresAt
						? new Date(organization.chatPlanExpiresAt).toLocaleDateString()
						: "your next billing date";
					throw new HTTPException(402, {
						message: `No API key set for provider. Chat Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
					});
				}
				if (organization.devPlan !== "none" && devPlanCreditsRemaining <= 0) {
					const renewalDate = organization.devPlanExpiresAt
						? new Date(organization.devPlanExpiresAt).toLocaleDateString()
						: "your next billing date";
					throw new HTTPException(402, {
						message: `No API key set for provider. Dev Plan credit limit reached. Upgrade your plan or wait for renewal on ${renewalDate}.`,
					});
				}
				throw new HTTPException(402, {
					message:
						"No API key set for provider and organization has insufficient credits",
				});
			}

			if (usedProvider === "llmgateway") {
				throw new HTTPException(400, {
					message:
						"Custom models require a provider key configured in your organization settings.",
				});
			}

			const envResult = getProviderEnv(usedProvider, {
				selectionScope: usedInternalModel,
			});
			usedToken = envResult.token;
			configIndex = envResult.configIndex;
			envVarName = envResult.envVarName;

			// Override with region-specific env var if a non-default region is selected.
			// Health attribution must follow the credential we actually send.
			if (usedRegion) {
				const regionEnvVarName = getRegionSpecificEnvVarName(
					usedProvider,
					usedRegion,
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
		}
	} else {
		throw new HTTPException(400, {
			message: `Invalid project mode: ${project.mode}`,
		});
	}

	if (usedProvider === "vertex-anthropic") {
		const gcpToken = await getGcpAccessToken();
		if (gcpToken) {
			usedToken = gcpToken;
		}
	}

	// Check email verification and rate limits for free models (only when using credits/environment tokens)
	if (
		isModelTrulyFree((finalModelInfo ?? modelInfo) as ModelDefinition) &&
		(!providerKey || !providerKey.token)
	) {
		await validateFreeModelUsage(
			c,
			project.organizationId,
			usedInternalModel,
			modelInfo as ModelDefinition,
			{ skipEmailVerification: onboarding },
		);
	}

	// Consume a rate-limit slot for the chosen provider (routing already filtered rate-limited ones)
	{
		const providerRateLimitResult = await checkProviderRateLimit(
			project.organizationId,
			usedProvider,
			modelInfo.id,
		);

		const providerRateLimitEntries = Object.entries(
			providerRateLimitResult.limits,
		) as Array<
			[
				keyof typeof providerRateLimitWindows,
				(typeof providerRateLimitResult.limits)[keyof typeof providerRateLimitResult.limits],
			]
		>;
		const primaryProviderRateLimit = providerRateLimitEntries.find(
			([, limit]) => limit.limit > 0,
		);

		if (primaryProviderRateLimit) {
			c.header(
				"X-RateLimit-Limit-Provider",
				primaryProviderRateLimit[1].limit.toString(),
			);
			c.header(
				"X-RateLimit-Remaining-Provider",
				primaryProviderRateLimit[1].remaining.toString(),
			);
		}

		for (const [window, limit] of providerRateLimitEntries) {
			if (limit.limit === 0) {
				continue;
			}

			c.header(
				`X-RateLimit-Limit-Provider-${providerRateLimitWindows[window].headerSuffix}`,
				limit.limit.toString(),
			);
			c.header(
				`X-RateLimit-Remaining-Provider-${providerRateLimitWindows[window].headerSuffix}`,
				limit.remaining.toString(),
			);
		}

		// Race condition: between peek and consume, the window may have filled.
		// Only hard-block if the user explicitly requested this provider with no-fallback.
		if (!providerRateLimitResult.allowed) {
			if (noFallback && requestedProvider) {
				const retryAfter = providerRateLimitResult.retryAfter;
				if (retryAfter) {
					c.header("Retry-After", retryAfter.toString());
					const resetTime = Math.floor(Date.now() / 1000) + retryAfter;
					c.header("X-RateLimit-Reset", resetTime.toString());
				}

				const blockedLimits = providerRateLimitResult.blockedBy
					.map(
						(window) =>
							`${providerRateLimitResult.limits[window].limit} ${providerRateLimitWindows[window].label}`,
					)
					.join(" and ");

				throw new HTTPException(429, {
					message: `Rate limit exceeded: maximum ${blockedLimits} for this provider/model. Please try again later.`,
				});
			}
			// Otherwise proceed — the provider was the best available option from routing
			logger.warn(
				"Provider rate limit exceeded after routing (race condition), proceeding anyway",
				{
					organizationId: project.organizationId,
					provider: usedProvider,
					model: modelInfo.id,
					blockedBy: getExceededProviderRateLimitLabels(
						providerRateLimitResult.blockedBy,
					),
				},
			);
		}
	}

	// Check if organization has credits for data retention costs
	// Data storage is billed at $0.01 per 1M tokens, so we need credits when retention is enabled
	if (organization && organization.retentionLevel === "retain") {
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

		if (totalAvailableCredits <= 0) {
			throw new HTTPException(402, {
				message:
					"Organization has insufficient credits for data retention. Data retention requires credits for storage costs ($0.01 per 1M tokens). Please add credits or disable data retention in organization settings.",
			});
		}
	}

	if (!usedToken) {
		throw new HTTPException(500, {
			message: `No token`,
		});
	}

	usedApiKeyHash = getApiKeyFingerprint(usedToken);
	routingMetadata = withUsedApiKeyHash(routingMetadata, usedApiKeyHash);

	// Vertex's OpenAI-compatible endpoint requires an OAuth2 access token
	// derived from the configured service account JSON. The SA JSON is the
	// long-lived credential (kept in usedApiKeyHash above for health tracking)
	// while the short-lived access token is what travels in the Authorization
	// header — so swap usedToken here so downstream header builders just work.
	// usedToken already holds the selected SA JSON: round-robin no longer
	// splits a JSON credential on its inner commas, so the selected entry is
	// used as-is (whether it came from a provider key or the env var).
	if (usedProvider === "vertex-openai") {
		usedToken = await getVertexOpenAIAccessToken(usedToken);
	}

	const contentFilterBlocked =
		contentFilterMode === "enabled" &&
		contentFilterMatched &&
		!contentFilterRoutingApplied;

	// Preserve monitor tagging, and also tag successful reroutes triggered by a
	// gateway content-filter match so the decision remains visible in logs.
	const shouldTagContentFilter =
		(contentFilterMode === "monitor" && contentFilterMatched) ||
		contentFilterRoutingApplied;
	const gatewayContentFilterResponse = openAIContentFilterResult?.responses
		.length
		? openAIContentFilterResult.responses
		: null;
	const insertLog = (
		logData: Parameters<typeof _insertLog>[0],
		options?: Parameters<typeof _insertLog>[1],
	) =>
		_insertLog(
			{
				...logData,
				sessionId: logData.sessionId ?? sessionId ?? null,
				internalContentFilter: shouldTagContentFilter
					? true
					: logData.internalContentFilter,
				gatewayContentFilterResponse:
					logData.gatewayContentFilterResponse ?? gatewayContentFilterResponse,
			},
			options,
		);

	if (contentFilterBlocked) {
		const contentFilterResponseId = `chatcmpl-${Date.now()}`;
		const contentFilterCreated = Math.floor(Date.now() / 1000);

		// Log the filtered request
		try {
			await insertLog({
				...createLogEntry(
					requestId,
					project,
					apiKey,
					undefined,
					"",
					undefined,
					"llmgateway",
					requestedModel,
					requestedProvider,
					messages as any[],
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					undefined,
					undefined,
					effort as "low" | "medium" | "high" | undefined,
					response_format,
					tools,
					tool_choice,
					source,
					customHeaders,
					c.req.header("x-debug") === "true",
					c.req.header("user-agent"),
				),
				content: null,
				responseSize: 0,
				finishReason: "llmgateway_content_filter",
				unifiedFinishReason: "content_filter",
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: false,
				streamed: !!stream,
				canceled: false,
				errorDetails: null,
				duration: 0,
				timeToFirstToken: null,
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
				dataStorageCost: "0",
			});
		} catch {
			// Silently ignore logging failures
		}

		if (stream) {
			return streamSSE(c, async (sseStream) => {
				const chunk = {
					id: contentFilterResponseId,
					object: "chat.completion.chunk",
					created: contentFilterCreated,
					model: requestedModel,
					choices: [
						{
							index: 0,
							delta: {},
							finish_reason: "content_filter",
						},
					],
				};
				await sseStream.writeSSE({
					data: JSON.stringify(chunk),
					id: "0",
				});
				await sseStream.writeSSE({ data: "[DONE]" });
			});
		}

		return c.json({
			id: contentFilterResponseId,
			object: "chat.completion",
			created: contentFilterCreated,
			model: requestedModel,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: null,
					},
					finish_reason: "content_filter",
				},
			],
			usage: {
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
		});
	}

	// Check if the selected provider supports reasoning (from specific mapping, not any)
	const selectedProviderMapping = modelInfo.providers.find(
		(p) => p.providerId === usedProvider && p.region === usedRegion,
	);
	let supportsReasoning = selectedProviderMapping?.reasoning === true;
	let splitTaggedReasoning =
		selectedProviderMapping?.splitTaggedReasoning === true;
	let healStreamingJsonOutput =
		selectedProviderMapping?.healStreamingJsonOutput === true;

	// Check if messages contain existing tool calls or tool results
	// If so, use Chat Completions API instead of Responses API
	const hasExistingToolCalls = messages.some(
		(msg: any) => msg.tool_calls ?? msg.role === "tool",
	);

	// Strip :region suffix, then apply azure_deployment_name override if set
	// so users can target deployments whose names differ from the registry.
	const azureDeploymentName =
		usedProvider === "azure"
			? providerKey?.options?.azure_deployment_name
			: undefined;
	const upstreamModelName = azureDeploymentName || usedExternalId;

	try {
		if (!usedProvider) {
			throw new HTTPException(400, {
				message: "No provider available for the requested model",
			});
		}

		url = getProviderEndpoint(
			usedProvider,
			providerKey?.baseUrl ?? undefined,
			upstreamModelName,
			usesGoogleQueryToken(usedProvider) ? usedToken : undefined,
			stream,
			supportsReasoning,
			hasExistingToolCalls,
			providerKey?.options ?? undefined,
			configIndex,
			isImageGeneration,
			usedRegion,
			providerKey !== undefined,
			usedInternalModel,
		);

		// If region is still unset but the provider supports regions, resolve the
		// default region so it appears in logs and metadata.
		if (!usedRegion) {
			const providerDef = providers.find((p) => p.id === usedProvider) as
				| { regionConfig?: { defaultRegion: string } }
				| undefined;
			if (providerDef?.regionConfig) {
				usedRegion = providerDef.regionConfig.defaultRegion;
			}
		}

		// Re-compute usedModelFormatted now that region may have been resolved
		if (usedRegion) {
			usedModelFormatted = formatUsedModelForDisplay(
				usedProvider,
				usedInternalModel,
				customProviderName,
				usedRegion,
			);
		}
	} catch (error) {
		if (usedProvider === "llmgateway" && usedInternalModel !== "custom") {
			throw new HTTPException(400, {
				message: `Invalid model: ${usedInternalModel} for provider: ${usedProvider}`,
			});
		}

		throw new HTTPException(500, {
			message: `Could not use provider: ${usedProvider}. ${error instanceof Error ? error.message : ""}`,
		});
	}

	let useResponsesApi = url?.includes("/responses") ?? false;

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}. Please add a base URL in your settings.`,
		});
	}

	// Check if caching is enabled for this project. Dev plan orgs never get
	// gateway-level response caching — the feature is offered only on regular
	// (non-devpass) organizations.
	const {
		enabled: projectCachingEnabled,
		duration: cacheDuration,
		providerCacheControlEnabled,
	} = await isCachingEnabled(project.id);
	const cachingEnabled =
		organization.devPlan !== "none" ? false : projectCachingEnabled;

	let cacheKey: string | null = null;
	let streamingCacheKey: string | null = null;

	if (cachingEnabled) {
		const cachePayload = {
			provider: usedProvider,
			model: usedInternalModel,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			response_format,
			reasoning_effort,
			reasoning_max_tokens,
			prompt_cache_key,
			prompt_cache_retention,
			n,
			service_tier,
		};

		if (stream) {
			streamingCacheKey = generateStreamingCacheKey(cachePayload);
			const cachedStreamingResponse =
				await getStreamingCache(streamingCacheKey);
			if (cachedStreamingResponse?.metadata.completed) {
				// Extract final content and metadata from cached chunks
				let fullContent = "";
				let fullReasoningContent = "";
				let promptTokens = null;
				let completionTokens = null;
				let totalTokens = null;
				let reasoningTokens = null;
				let cachedTokens = null;
				let cacheWriteTokens: number | null = null;
				let cacheWrite1hTokens: number | null = null;
				let audioInputTokens: number | null = null;
				let rawCachedResponseData = ""; // Raw SSE data from cached response
				let cachedResponseSize = 0; // Track size incrementally to avoid expensive stringify

				for (const chunk of cachedStreamingResponse.chunks) {
					// Track response size incrementally (sum of chunk data lengths + overhead)
					cachedResponseSize += chunk.data.length + 50; // 50 bytes overhead per chunk for metadata
					// Reconstruct raw SSE data for logging only in debug mode and within size limit
					if (debugMode && rawCachedResponseData.length < MAX_RAW_DATA_SIZE) {
						const sseString = `${chunk.event ? `event: ${chunk.event}\n` : ""}data: ${chunk.data}${chunk.eventId ? `\nid: ${chunk.eventId}` : ""}\n\n`;
						rawCachedResponseData += sseString;
					}

					try {
						// Skip "[DONE]" markers as they are not JSON
						if (chunk.data === "[DONE]") {
							continue;
						}

						const chunkData = JSON.parse(chunk.data);

						// Extract content and reasoning from every choice so a cached
						// n > 1 stream replay reconstructs the full logging buffer
						// rather than only choice 0.
						if (Array.isArray(chunkData.choices)) {
							for (const choice of chunkData.choices) {
								if (typeof choice?.delta?.content === "string") {
									fullContent += choice.delta.content;
								}
								if (typeof choice?.delta?.reasoning === "string") {
									fullReasoningContent += choice.delta.reasoning;
								}
							}
						}

						// Extract usage information (usually in the last chunks)
						if (chunkData.usage) {
							if (chunkData.usage.prompt_tokens) {
								promptTokens = chunkData.usage.prompt_tokens;
							}
							if (chunkData.usage.completion_tokens) {
								completionTokens = chunkData.usage.completion_tokens;
							}
							if (chunkData.usage.total_tokens) {
								totalTokens = chunkData.usage.total_tokens;
							}
							if (chunkData.usage.reasoning_tokens) {
								reasoningTokens = chunkData.usage.reasoning_tokens;
							}
							if (chunkData.usage.prompt_tokens_details?.cached_tokens) {
								cachedTokens =
									chunkData.usage.prompt_tokens_details.cached_tokens;
							}
							const chunkCacheWrite =
								chunkData.usage.prompt_tokens_details?.cache_write_tokens ??
								chunkData.usage.prompt_tokens_details?.cache_creation_tokens;
							if (chunkCacheWrite !== undefined && chunkCacheWrite !== null) {
								cacheWriteTokens = chunkCacheWrite;
							}
							const chunkCacheWrite1h =
								chunkData.usage.prompt_tokens_details?.cache_creation
									?.ephemeral_1h_input_tokens;
							if (
								chunkCacheWrite1h !== undefined &&
								chunkCacheWrite1h !== null
							) {
								cacheWrite1hTokens = chunkCacheWrite1h;
							}
							const chunkAudioTokens =
								chunkData.usage.prompt_tokens_details?.audio_tokens;
							if (chunkAudioTokens !== undefined && chunkAudioTokens !== null) {
								audioInputTokens = chunkAudioTokens;
							}
						}
					} catch (e) {
						// Skip malformed chunks
						logger.warn("Failed to parse cached chunk", {
							error: e instanceof Error ? e : new Error(String(e)),
						});
					}
				}

				// Log the cached streaming request with reconstructed content
				// Extract plugin IDs for logging (cached streaming)
				const cachedStreamingPluginIds = plugins?.map((p) => p.id) ?? [];

				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModelFormatted,
					usedModelMapping,
					usedProvider,
					initialRequestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					reasoning_effort,
					reasoning_max_tokens,
					effort,
					response_format,
					tools,
					tool_choice,
					source,
					customHeaders,
					debugMode,
					userAgent,
					image_config,
					routingMetadata,
					rawBody,
					rawCachedResponseData, // Raw SSE data from cached response
					null, // No upstream request for cached response
					rawCachedResponseData, // Raw SSE data from cached response (same for both)
					cachedStreamingPluginIds,
					undefined, // No plugin results for cached response
				);

				// Calculate costs for cached response
				const costs = await calculateCosts(
					usedInternalModel,
					usedProvider,
					usedRegion ?? null,
					promptTokens ?? null,
					completionTokens ?? null,
					cachedTokens ?? null,
					undefined,
					reasoningTokens ?? null,
					0, // outputImageCount
					undefined, // imageSize
					inputImageCount,
					null, // webSearchCount
					project.organizationId,
					undefined,
					null,
					null,
					{
						cacheWriteTokens,
						cacheWrite1hTokens,
						audioInputTokens,
						explicitCacheUsed,
					},
				);

				await insertLogEntry({
					...baseLogEntry,
					id: finalLogId,
					duration: 0, // No processing time for cached response
					timeToFirstToken: null, // Not applicable for cached response
					timeToFirstReasoningToken: null, // Not applicable for cached response
					responseSize: cachedResponseSize,
					content: fullContent || null,
					reasoningContent: fullReasoningContent || null,
					finishReason: cachedStreamingResponse.metadata.finishReason,
					promptTokens:
						(costs.promptTokens ?? promptTokens)?.toString() ?? null,
					completionTokens: completionTokens?.toString() ?? null,
					totalTokens: costs.imageInputTokens
						? (
								(costs.promptTokens ?? promptTokens ?? 0) +
								(completionTokens ?? 0) +
								(reasoningTokens ?? 0)
							).toString()
						: (totalTokens?.toString() ?? null),
					reasoningTokens: reasoningTokens?.toString() ?? null,
					cachedTokens: cachedTokens?.toString() ?? null,
					cacheWriteTokens: cacheWriteTokens?.toString() ?? null,
					hasError: false,
					streamed: true,
					canceled: false,
					errorDetails: null,
					// Gateway response cache hits are served entirely from Redis with no
					// upstream provider call, so they are free. Keep token counts for
					// analytics but record zero cost (matches the worker's `!cached`
					// billing skip and the documented `cost: 0` dashboard behavior).
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					cacheWriteInputCost: 0,
					requestCost: 0,
					webSearchCost: 0,
					imageInputTokens: costs.imageInputTokens?.toString() ?? null,
					imageOutputTokens: costs.imageOutputTokens?.toString() ?? null,
					imageInputCost: 0,
					imageOutputCost: 0,
					audioInputTokens: costs.audioInputTokens?.toString() ?? null,
					audioInputCost: 0,
					cost: 0,
					estimatedCost: costs.estimatedCost,
					discount: costs.discount ?? null,
					pricingTier: costs.pricingTier ?? null,
					dataStorageCost: "0",
					cached: true,
					toolResults:
						(cachedStreamingResponse.metadata as { toolResults?: any })
							?.toolResults ?? null,
				});

				const cachedResponseMetadata = buildFinalResponseMetadata(
					costs.discount ?? null,
				);
				let hasMetadataChunk = false;
				for (
					let chunkIndex = cachedStreamingResponse.chunks.length - 1;
					chunkIndex >= 0;
					chunkIndex--
				) {
					const chunk = cachedStreamingResponse.chunks[chunkIndex];
					if (!chunk) {
						continue;
					}
					const isMetadataChunk = (() => {
						if (chunk.data === "[DONE]") {
							return false;
						}
						try {
							const parsed: unknown = JSON.parse(chunk.data);
							return (
								typeof parsed === "object" &&
								parsed !== null &&
								!Array.isArray(parsed) &&
								("usage" in parsed || "metadata" in parsed)
							);
						} catch {
							return false;
						}
					})();
					if (isMetadataChunk) {
						hasMetadataChunk = true;
						break;
					}
				}

				// Return cached streaming response by replaying chunks with original timing
				return streamSSE(
					c,
					async (stream) => {
						let previousTimestamp = 0;

						for (const chunk of cachedStreamingResponse.chunks) {
							// Calculate delay based on original chunk timing
							const delay = Math.max(0, chunk.timestamp - previousTimestamp);
							// Cap the delay to prevent excessively long waits (max 1 second)
							const cappedDelay = Math.min(delay, 1000);

							if (cappedDelay > 0) {
								await new Promise<void>((resolve) => {
									setTimeout(() => resolve(), cappedDelay);
								});
							}

							let data = chunk.data;
							if (hasMetadataChunk && chunk.data !== "[DONE]") {
								let parsed: Record<string, unknown> | undefined;
								try {
									const parsedValue: unknown = JSON.parse(chunk.data);
									if (
										typeof parsedValue === "object" &&
										parsedValue !== null &&
										!Array.isArray(parsedValue) &&
										("usage" in parsedValue || "metadata" in parsedValue)
									) {
										parsed = parsedValue;
									}
								} catch {
									parsed = undefined;
								}
								if (parsed) {
									const metadata =
										typeof parsed.metadata === "object" &&
										parsed.metadata !== null &&
										!Array.isArray(parsed.metadata)
											? parsed.metadata
											: {};
									data = JSON.stringify({
										...parsed,
										metadata: {
											...metadata,
											...cachedResponseMetadata,
										},
									});
								}
							} else if (!hasMetadataChunk && chunk.data === "[DONE]") {
								// No usage/metadata chunk in the cached stream — emit a
								// synthetic metadata chunk before [DONE] so consumers always
								// receive logId, organizationId, projectId, and discount.
								await stream.writeSSE({
									data: JSON.stringify({ metadata: cachedResponseMetadata }),
									id: `${chunk.eventId}-metadata`,
								});
							}

							await stream.writeSSE({
								data,
								id: String(chunk.eventId),
								event: chunk.event,
							});

							previousTimestamp = chunk.timestamp;
						}
					},
					async (error) => {
						if (error.name === "AbortError") {
							logger.info("Cached stream replay aborted by client", {
								path: c.req.path,
							});
						} else {
							logger.error("Error replaying cached stream", error);
						}
					},
				);
			}
		} else {
			cacheKey = generateCacheKey(cachePayload);
			const cachedResponse = cacheKey ? await getCache(cacheKey) : null;
			if (cachedResponse) {
				// Log the cached request
				const duration = 0; // No processing time needed

				// Calculate costs for cached response
				const cachedCosts = await calculateCosts(
					usedInternalModel,
					usedProvider,
					usedRegion ?? null,
					cachedResponse.usage?.prompt_tokens ?? null,
					cachedResponse.usage?.completion_tokens ?? null,
					cachedResponse.usage?.prompt_tokens_details?.cached_tokens ?? null,
					undefined,
					cachedResponse.usage?.reasoning_tokens ?? null,
					0, // outputImageCount
					undefined, // imageSize
					inputImageCount,
					null, // webSearchCount
					project.organizationId,
					undefined,
					null,
					null,
					{
						cacheWriteTokens:
							cachedResponse.usage?.prompt_tokens_details?.cache_write_tokens ??
							cachedResponse.usage?.prompt_tokens_details
								?.cache_creation_tokens ??
							null,
						cacheWrite1hTokens:
							cachedResponse.usage?.prompt_tokens_details?.cache_creation
								?.ephemeral_1h_input_tokens ?? null,
						audioInputTokens:
							cachedResponse.usage?.prompt_tokens_details?.audio_tokens ?? null,
						explicitCacheUsed,
					},
				);

				const responseForCurrentRequest =
					withCurrentRequestMetadataOnOpenAiResponse(
						cachedResponse,
						requestId,
						{
							logId: finalLogId,
							organizationId: project.organizationId,
							projectId: apiKey.projectId,
							discount: cachedCosts.discount ?? null,
						},
					);

				// Extract plugin IDs for logging (cached non-streaming)
				const cachedPluginIds = plugins?.map((p) => p.id) ?? [];

				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModelFormatted,
					usedModelMapping,
					usedProvider,
					initialRequestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					reasoning_effort,
					reasoning_max_tokens,
					effort,
					response_format,
					tools,
					tool_choice,
					source,
					customHeaders,
					debugMode,
					userAgent,
					image_config,
					routingMetadata,
					rawBody,
					responseForCurrentRequest,
					null, // No upstream request for cached response
					responseForCurrentRequest, // upstream response is same as cached response
					cachedPluginIds,
					undefined, // No plugin results for cached response
				);

				// Estimate cached response size based on content to avoid expensive stringify
				const cachedContent = cachedResponse.choices?.[0]?.message?.content;
				const cachedReasoningContent =
					cachedResponse.choices?.[0]?.message?.reasoning;
				const estimatedCachedSize =
					(cachedContent?.length ?? 0) +
					(cachedReasoningContent?.length ?? 0) +
					500; // overhead for metadata

				await insertLogEntry({
					...baseLogEntry,
					id: finalLogId,
					duration,
					timeToFirstToken: null, // Not applicable for cached response
					timeToFirstReasoningToken: null, // Not applicable for cached response
					responseSize: estimatedCachedSize,
					content: cachedContent ?? null,
					reasoningContent: cachedReasoningContent ?? null,
					finishReason: cachedResponse.choices?.[0]?.finish_reason ?? null,
					promptTokens:
						(
							cachedCosts.promptTokens ?? cachedResponse.usage?.prompt_tokens
						)?.toString() ?? null,
					completionTokens: cachedResponse.usage?.completion_tokens ?? null,
					totalTokens: cachedCosts.imageInputTokens
						? (
								(cachedCosts.promptTokens ??
									cachedResponse.usage?.prompt_tokens ??
									0) +
								(cachedResponse.usage?.completion_tokens ?? 0) +
								(cachedResponse.usage?.reasoning_tokens ?? 0)
							).toString()
						: (cachedResponse.usage?.total_tokens ?? null),
					reasoningTokens: cachedResponse.usage?.reasoning_tokens ?? null,
					cachedTokens:
						cachedResponse.usage?.prompt_tokens_details?.cached_tokens ?? null,
					cacheWriteTokens:
						(
							cachedResponse.usage?.prompt_tokens_details?.cache_write_tokens ??
							cachedResponse.usage?.prompt_tokens_details?.cache_creation_tokens
						)?.toString() ?? null,
					hasError: false,
					streamed: false,
					canceled: false,
					errorDetails: null,
					// Gateway response cache hits are served entirely from Redis with no
					// upstream provider call, so they are free. Keep token counts for
					// analytics but record zero cost (matches the worker's `!cached`
					// billing skip and the documented `cost: 0` dashboard behavior).
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					cacheWriteInputCost: 0,
					requestCost: 0,
					webSearchCost: 0,
					imageInputTokens: cachedCosts.imageInputTokens?.toString() ?? null,
					imageOutputTokens: cachedCosts.imageOutputTokens?.toString() ?? null,
					imageInputCost: 0,
					imageOutputCost: 0,
					audioInputTokens: cachedCosts.audioInputTokens?.toString() ?? null,
					audioInputCost: 0,
					cost: 0,
					estimatedCost: cachedCosts.estimatedCost,
					discount: cachedCosts.discount ?? null,
					pricingTier: cachedCosts.pricingTier ?? null,
					dataStorageCost: "0",
					cached: true,
					toolResults: cachedResponse.choices?.[0]?.message?.tool_calls ?? null,
				});

				return c.json(responseForCurrentRequest);
			}
		}
	}

	// Validate max_tokens against model's maxOutput limit
	if (max_tokens !== undefined && finalModelInfo) {
		// Find the provider mapping for the used provider
		const providerMapping = finalModelInfo.providers.find(
			(p) => p.providerId === usedProvider && p.region === usedRegion,
		);

		if (
			providerMapping &&
			"maxOutput" in providerMapping &&
			providerMapping.maxOutput !== undefined
		) {
			if (max_tokens > providerMapping.maxOutput) {
				throw new HTTPException(400, {
					message: `The requested max_tokens (${max_tokens}) exceeds the maximum output tokens allowed for model ${usedInternalModel} (${providerMapping.maxOutput})`,
				});
			}
		}
	}

	// Check if streaming is requested and if the model/provider combination supports it
	// For image generation models, we'll fake streaming by converting the response
	const fakeStreamingForImageGen = stream && isImageGeneration;
	const streamingSupport = getModelStreamingSupport(
		usedInternalModel,
		usedProvider,
		usedRegion,
	);
	// When the provider only supports streaming, force it even if the client didn't request it.
	// The upstream request uses effectiveStream; the client response uses stream.
	const forceStream = streamingSupport === "only" && !stream;
	// Force upstream SSE for OpenAI/Azure gpt-image-* regardless of what the client
	// requested. For image generation the upstream request is always non-streaming
	// (effectiveStream is forced false above when faking streaming for the client),
	// so partial_images=1 is needed in both cases to keep the connection alive past
	// Azure's 122s synchronous wall and to use AI_STREAMING_TIMEOUT_MS (1200s default)
	// instead of AI_TIMEOUT_MS (600s). The SSE response is collapsed back into the
	// regular non-streaming JSON shape before being returned (or re-wrapped as fake
	// SSE for clients that requested streaming).
	let forceImageStreamUpstream =
		isImageGeneration &&
		(usedProvider === "openai" || usedProvider === "azure");
	const effectiveStream = fakeStreamingForImageGen
		? false
		: stream || forceStream;

	if (stream) {
		if (!isImageGeneration && streamingSupport === false) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} does not support streaming`,
			});
		}
	}

	// Check if effort parameter is supported by the specific provider being used
	if (effort !== undefined && finalModelInfo) {
		const providerMapping = finalModelInfo.providers.find(
			(p) => p.providerId === usedProvider && p.region === usedRegion,
		);

		if (providerMapping) {
			const params = providerMapping.supportedParameters;
			if (!params?.includes("effort")) {
				throw new HTTPException(400, {
					message: `Model ${usedInternalModel} with provider ${usedProvider} does not support the effort parameter. Try using provider 'anthropic' instead.`,
				});
			}
		}
	}

	// Reject n > 1 when the resolved provider mapping does not advertise
	// supportsN. We only forward n upstream for providers/models that bill
	// input tokens once and accumulate output across choices natively
	// (currently OpenAI Chat Completions models).
	if (n !== undefined && n > 1 && finalModelInfo) {
		const providerMapping = finalModelInfo.providers.find(
			(p) => p.providerId === usedProvider && p.region === usedRegion,
		);
		if (!providerMapping?.supportsN) {
			throw new HTTPException(400, {
				message: `Model ${usedInternalModel} with provider ${usedProvider} does not support the n parameter for multiple choices. Send n separate requests instead.`,
			});
		}
	}

	// Save original parameters before provider-specific stripping for retry fallback
	const originalRequestParams: OriginalRequestParams = {
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
	};

	// Strip unsupported parameters based on model's supportedParameters
	if (finalModelInfo) {
		const providerMapping = finalModelInfo.providers.find(
			(p) => p.providerId === usedProvider && p.region === usedRegion,
		);
		const supported = providerMapping?.supportedParameters;
		if (supported && supported.length > 0) {
			if (temperature !== undefined && !supported.includes("temperature")) {
				temperature = undefined;
			}
			if (top_p !== undefined && !supported.includes("top_p")) {
				top_p = undefined;
			}
			if (
				frequency_penalty !== undefined &&
				!supported.includes("frequency_penalty")
			) {
				frequency_penalty = undefined;
			}
			if (
				presence_penalty !== undefined &&
				!supported.includes("presence_penalty")
			) {
				presence_penalty = undefined;
			}
			if (max_tokens !== undefined && !supported.includes("max_tokens")) {
				max_tokens = undefined;
			}
		}
	}

	// Anthropic does not allow temperature and top_p to be set simultaneously
	if (usedProvider === "anthropic" || usedProvider === "vertex-anthropic") {
		if (temperature !== undefined && top_p !== undefined) {
			top_p = undefined;
		}
	}

	// Check if the request can be canceled
	let requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	// For Google providers, enrich messages with cached thought_signatures
	// This is needed for multi-turn tool call conversations with Gemini 3+
	if (isGoogleCompatibleProvider(usedProvider)) {
		const { redisClient } = await import("@llmgateway/cache");
		for (const message of messages) {
			if (
				message.role === "assistant" &&
				message.tool_calls &&
				Array.isArray(message.tool_calls)
			) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.id) {
						try {
							// Use redisClient.get directly since thought_signature is a plain string, not JSON
							const cachedSignature = await redisClient.get(
								`thought_signature:${toolCall.id}`,
							);
							if (cachedSignature) {
								// Add to extra_content so transformGoogleMessages can find it
								if (!(toolCall as any).extra_content) {
									(toolCall as any).extra_content = {};
								}
								if (!(toolCall as any).extra_content.google) {
									(toolCall as any).extra_content.google = {};
								}
								(toolCall as any).extra_content.google.thought_signature =
									cachedSignature;
							}
						} catch {
							// Silently fail - thought_signature is optional
						}
					}
				}
			}
		}
	}

	let requestBody: ProviderRequestBody | FormData;
	try {
		requestBody = await prepareRequestBody(
			usedProvider,
			usedInternalModel,
			usedRegion ?? null,
			upstreamModelName,
			messages as BaseMessage[],
			effectiveStream,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			response_format,
			tools,
			tool_choice,
			reasoning_effort,
			supportsReasoning,
			process.env.NODE_ENV === "production",
			maxImageSizeMB,
			userPlan,
			sensitive_word_check,
			image_config,
			effort,
			isImageGeneration,
			webSearchTool,
			reasoning_max_tokens,
			useResponsesApi,
			prompt_cache_key,
			prompt_cache_retention,
			providerCacheControlEnabled,
			n,
			getForwardedServiceTier(
				usedInternalModel,
				usedProvider,
				usedRegion,
				service_tier,
				configIndex,
			),
		);
	} catch (e) {
		// Surface typed pre-upstream input errors in the activity feed as a
		// client_error. Without this, app.onError returns a 400 but no log row
		// is written, so the user never sees the rejected request in history.
		if (
			e instanceof InvalidFileContentError ||
			e instanceof UnsupportedAudioFormatError ||
			e instanceof UnsupportedDocumentFormatError
		) {
			try {
				await insertLogEntry({
					...createLogEntry(
						requestId,
						project,
						apiKey,
						undefined,
						upstreamModelName,
						undefined,
						usedProvider,
						requestedModel,
						requestedProvider,
						messages as any[],
						temperature,
						max_tokens,
						top_p,
						frequency_penalty,
						presence_penalty,
						reasoning_effort,
						reasoning_max_tokens,
						effort as "low" | "medium" | "high" | undefined,
						response_format,
						tools,
						tool_choice,
						source,
						customHeaders,
						debugMode,
						userAgent,
					),
					content: null,
					responseSize: 0,
					finishReason: "client_error",
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: true,
					streamed: !!stream,
					canceled: false,
					errorDetails: {
						statusCode: 400,
						statusText: "Bad Request",
						responseText: e.message,
						cause: e.constructor.name,
					},
					duration: 0,
					timeToFirstToken: null,
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
					dataStorageCost: "0",
				});
			} catch {
				// Silently ignore logging failures
			}
		}
		throw e;
	}

	if (forceImageStreamUpstream) {
		requestBody = injectImageStreamParams(requestBody);
	}

	// Validate effective max_tokens value after prepareRequestBody
	if (
		!(requestBody instanceof FormData) &&
		hasMaxTokens(requestBody) &&
		requestBody.max_tokens !== undefined &&
		finalModelInfo
	) {
		// Find the provider mapping for the used provider
		const providerMapping = finalModelInfo.providers.find(
			(p) => p.providerId === usedProvider && p.region === usedRegion,
		);
		if (
			providerMapping &&
			"maxOutput" in providerMapping &&
			providerMapping.maxOutput !== undefined
		) {
			if (requestBody.max_tokens > providerMapping.maxOutput) {
				throw new HTTPException(400, {
					message: `The effective max_tokens (${requestBody.max_tokens}) exceeds the maximum output tokens allowed for model ${usedInternalModel} (${providerMapping.maxOutput})`,
				});
			}
		}
	}

	// Switch xAI image generation endpoint to /edits when input images are present
	if (
		isImageGeneration &&
		usedProvider === "xai" &&
		url &&
		!(requestBody instanceof FormData) &&
		("image" in requestBody || "images" in requestBody)
	) {
		url = url.replace("/v1/images/generations", "/v1/images/edits");
	}

	// Switch OpenAI image generation endpoint to /edits when input images are present.
	// prepareRequestBody returns a FormData (multipart/form-data) only for this edits flow.
	if (
		isImageGeneration &&
		usedProvider === "openai" &&
		url &&
		requestBody instanceof FormData
	) {
		url = url.replace("/v1/images/generations", "/v1/images/edits");
	}

	// Switch Azure image generation endpoint to /edits when input images are present.
	// Handles both ai-foundry (/openai/v1/images/generations?api-version=preview) and
	// deployment-based (/openai/deployments/{model}/images/generations?api-version=...)
	// URL shapes — the literal "/images/generations" substring appears before the
	// query string in both, so the in-place replace works for both.
	if (
		isImageGeneration &&
		usedProvider === "azure" &&
		url &&
		requestBody instanceof FormData
	) {
		url = url.replace("/images/generations", "/images/edits");
	}

	const startTime = Date.now();
	const failedKeys = createFailedKeyTracker();

	function rememberFailedKey(
		providerId: string,
		region: string | undefined,
		options: {
			envVarName?: string;
			configIndex?: number;
			providerKeyId?: string;
		},
	): void {
		failedKeys.remember(providerId, region, options);
	}

	async function resolveProviderContextForRetry(
		providerMapping: {
			providerId: string;
			externalId: string;
			region?: string;
		},
		streamValue: boolean,
	) {
		return await resolveProviderContext(
			providerMapping,
			retryProjectContext,
			retryOrganizationContext,
			modelInfo,
			originalRequestParams,
			{
				requestId,
				stream: streamValue,
				effectiveStream,
				messages: messages as BaseMessage[],
				response_format,
				tools,
				tool_choice,
				reasoning_effort,
				reasoning_max_tokens,
				prompt_cache_key,
				prompt_cache_retention,
				effort,
				webSearchTool,
				image_config,
				sensitive_word_check,
				maxImageSizeMB,
				userPlan,
				hasExistingToolCalls,
				customProviderName,
				webSearchEnabled: !!webSearchTool,
				excludedEnvKeyIndices: failedKeys.envKeyIndicesFor(
					providerMapping.providerId,
					providerMapping.region,
				),
				excludedProviderKeyIds: failedKeys.providerKeyIdsFor(
					providerMapping.providerId,
					providerMapping.region,
				),
				n,
				providerCacheControlEnabled,
				service_tier,
			},
		);
	}

	function applyResolvedProviderContext(
		ctx: Awaited<ReturnType<typeof resolveProviderContext>>,
	): void {
		usedProvider = ctx.usedProvider;
		usedInternalModel = ctx.usedInternalModel;
		usedExternalId = ctx.usedExternalId;
		usedModelFormatted = ctx.usedModelFormatted;
		usedModelMapping = ctx.usedModelMapping;
		usedToken = ctx.usedToken;
		usedApiKeyHash = ctx.usedApiKeyHash;
		providerKey = ctx.providerKey;
		trackedKeyHealthId = ctx.trackedKeyHealthId;
		configIndex = ctx.configIndex;
		envVarName = ctx.envVarName;
		url = ctx.url;
		requestBody = ctx.requestBody;
		useResponsesApi = ctx.useResponsesApi;
		requestCanBeCanceled = ctx.requestCanBeCanceled;
		isImageGeneration = ctx.isImageGeneration;
		forceImageStreamUpstream =
			isImageGeneration &&
			(usedProvider === "openai" || usedProvider === "azure");
		if (forceImageStreamUpstream) {
			requestBody = injectImageStreamParams(requestBody);
		}
		// resolveProviderContext only knows the base /images/generations endpoint;
		// mirror the post-prepareRequestBody URL swap so retry fallbacks still hit
		// /images/edits when the body is multipart FormData.
		if (
			isImageGeneration &&
			usedProvider === "openai" &&
			url &&
			requestBody instanceof FormData
		) {
			url = url.replace("/v1/images/generations", "/v1/images/edits");
		}
		if (
			isImageGeneration &&
			usedProvider === "azure" &&
			url &&
			requestBody instanceof FormData
		) {
			url = url.replace("/images/generations", "/images/edits");
		}
		if (
			isImageGeneration &&
			usedProvider === "xai" &&
			url &&
			!(requestBody instanceof FormData) &&
			("image" in requestBody || "images" in requestBody)
		) {
			url = url.replace("/v1/images/generations", "/v1/images/edits");
		}
		supportsReasoning = ctx.supportsReasoning;
		splitTaggedReasoning = ctx.splitTaggedReasoning ?? false;
		healStreamingJsonOutput = ctx.healStreamingJsonOutput ?? false;
		temperature = ctx.temperature;
		max_tokens = ctx.max_tokens;
		top_p = ctx.top_p;
		frequency_penalty = ctx.frequency_penalty;
		presence_penalty = ctx.presence_penalty;
		usedRegion = ctx.usedRegion;
		routingMetadata = withUsedApiKeyHash(routingMetadata, usedApiKeyHash);
	}

	async function tryResolveAlternateKeyForCurrentProvider(
		streamValue: boolean,
	): Promise<Awaited<ReturnType<typeof resolveProviderContext>> | null> {
		if (!usedProvider || !usedInternalModel) {
			return null;
		}

		const currentProviderKeyId = providerKey?.id;
		const currentEnvVarName = envVarName;
		const currentConfigIndex = configIndex;
		const currentToken = usedToken;

		try {
			const nextContext = await resolveProviderContextForRetry(
				{
					providerId: usedProvider,
					externalId: usedExternalId,
					region: usedRegion,
				},
				streamValue,
			);

			const isDifferentTrackedKey =
				nextContext.providerKey?.id !== undefined &&
				nextContext.providerKey.id !== currentProviderKeyId;
			const isDifferentEnvKey =
				nextContext.envVarName !== undefined &&
				(nextContext.envVarName !== currentEnvVarName ||
					nextContext.configIndex !== currentConfigIndex);
			const isDifferentToken = nextContext.usedToken !== currentToken;

			if (!isDifferentTrackedKey && !isDifferentEnvKey && !isDifferentToken) {
				return null;
			}

			return nextContext;
		} catch {
			return null;
		}
	}

	// Handle streaming response if requested
	// For image generation models, we skip real streaming and use fake streaming later
	// For stream-only models where the client didn't request streaming, use the non-streaming path
	// (effectiveStream forces streaming upstream, but the client gets a regular JSON response)
	if (effectiveStream && !forceStream) {
		return streamSSE(
			c,
			async (stream) => {
				let eventId = 0;
				let canceled = false;
				let streamingError: unknown = null;
				let doneSent = false; // Track if [DONE] has been sent downstream

				// Raw logging variables
				let streamingRawResponseData = ""; // Raw SSE data sent back to the client

				// Streaming cache variables
				const streamingChunks: Array<{
					data: string;
					eventId: number;
					event?: string;
					timestamp: number;
				}> = [];
				const streamStartTime = Date.now();

				// SSE keepalive to prevent proxy/load balancer timeouts.
				// Sends a single-newline comment (no trailing blank line) so buggy
				// SSE parsers (e.g. openai-python <=2.37.0, openai/openai-python#2722)
				// don't dispatch an empty-data event from a `\n\n` sequence when
				// last_event_id is already set.
				const KEEPALIVE_INTERVAL_MS = 15000;
				const keepaliveInterval = setInterval(() => {
					stream.write(": ping\n").catch(() => {
						// Stream likely closed, cleanup will happen via abort handler or finally
					});
				}, KEEPALIVE_INTERVAL_MS);
				const clearKeepalive = () => clearInterval(keepaliveInterval);

				// Timing tracking variables
				let timeToFirstToken: number | null = null;
				let timeToFirstReasoningToken: number | null = null;
				let firstTokenReceived = false;
				let firstReasoningTokenReceived = false;

				// Helper function to write SSE and capture for cache
				const writeSSEAndCache = async (sseData: {
					data: string;
					event?: string;
					id?: string;
				}) => {
					await stream.writeSSE(sseData);

					// Collect raw response data for logging only in debug mode and within size limit
					if (
						debugMode &&
						streamingRawResponseData.length < MAX_RAW_DATA_SIZE
					) {
						const sseString = `${sseData.event ? `event: ${sseData.event}\n` : ""}data: ${sseData.data}${sseData.id ? `\nid: ${sseData.id}` : ""}\n\n`;
						streamingRawResponseData += sseString;
					}

					// Capture for streaming cache if enabled
					if (cachingEnabled && streamingCacheKey) {
						streamingChunks.push({
							data: sseData.data,
							eventId: sseData.id ? parseInt(sseData.id, 10) : eventId,
							event: sseData.event,
							timestamp: Date.now() - streamStartTime,
						});
					}
				};

				const writeStreamingContentFilterResponse = async ({
					billingModel,
					billingProvider,
					billingRegion,
					responseModel,
					metadata,
				}: {
					billingModel: string;
					billingProvider: Provider;
					billingRegion: string | null;
					responseModel: string;
					metadata?: Record<string, unknown>;
				}) => {
					const { calculatedPromptTokens } = estimateTokens(
						billingProvider,
						messages,
						null,
						null,
						0,
					);
					const promptTokenCount = Math.max(
						1,
						Math.round(calculatedPromptTokens ?? 1),
					);
					const streamingCosts = await calculateCosts(
						billingModel,
						billingProvider,
						billingRegion,
						promptTokenCount,
						0,
						null,
						{
							prompt: messages
								.map((m) => messageContentToString(m.content))
								.join("\n"),
							completion: "",
						},
						null,
						0,
						image_config?.image_size,
						inputImageCount,
						0,
						project.organizationId,
						image_config?.image_quality,
						null,
						null,
						{ explicitCacheUsed, servedServiceTier },
						true,
					);
					streamingCosts.dataStorageCost = toDataStorageCostNumber(
						streamingCosts.promptTokens ?? promptTokenCount,
						null,
						0,
						null,
						retentionLevel,
					);

					await writeSSEAndCache({
						data: JSON.stringify({
							id: `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: responseModel,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: "content_filter",
								},
							],
							...(metadata && { metadata }),
						}),
						id: String(eventId++),
					});

					const contentFilterUsage: Record<string, any> = {
						prompt_tokens: promptTokenCount,
						completion_tokens: 0,
						total_tokens: promptTokenCount,
					};
					applyExtendedUsageFields(contentFilterUsage, {
						costs: {
							inputCost: streamingCosts.inputCost,
							outputCost: streamingCosts.outputCost,
							cachedInputCost: streamingCosts.cachedInputCost,
							cacheWriteInputCost: streamingCosts.cacheWriteInputCost,
							requestCost: streamingCosts.requestCost,
							webSearchCost: streamingCosts.webSearchCost,
							contentFilterCost: streamingCosts.contentFilterCost,
							imageInputCost: streamingCosts.imageInputCost,
							imageOutputCost: streamingCosts.imageOutputCost,
							audioInputCost: streamingCosts.audioInputCost,
							totalCost: streamingCosts.totalCost,
							dataStorageCost: streamingCosts.dataStorageCost,
						},
						cachedTokens: null,
						cacheCreationTokens: null,
						reasoningTokens: null,
					});
					await writeSSEAndCache({
						data: JSON.stringify({
							id: `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: responseModel,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: null,
								},
							],
							usage: contentFilterUsage,
						}),
						id: String(eventId++),
					});

					await writeSSEAndCache({
						event: "done",
						data: "[DONE]",
						id: String(eventId++),
					});
					doneSent = true;
				};

				// Set up cancellation handling
				const controller = new AbortController();
				// Set up a listener for the request being aborted
				const onAbort = () => {
					clearKeepalive();
					if (requestCanBeCanceled) {
						canceled = true;
						controller.abort();
					}
				};

				// Add event listener for the abort event on the connection
				c.req.raw.signal.addEventListener("abort", onAbort);

				// --- Retry loop for provider fallback ---
				const routingAttempts: RoutingAttempt[] = [];
				const failedProviderIds = new Set<string>();
				let res: Response | undefined;
				for (
					let retryAttempt = 0;
					retryAttempt <= routingCfg.retry.maxRetries;
					retryAttempt++
				) {
					const perAttemptStartTime = Date.now();

					// Type guard: narrow variables that TypeScript widens due to loop reassignment
					if (
						!usedProvider ||
						!usedToken ||
						!url ||
						!usedModelFormatted ||
						!usedModelMapping
					) {
						throw new Error("Provider context not initialized");
					}

					if (retryAttempt > 0) {
						// Re-add abort listener (catch block removes it on error)
						c.req.raw.signal.addEventListener("abort", onAbort);

						const nextProvider = selectNextProvider(
							routingMetadata?.providerScores ?? [],
							failedProviderIds,
							iamFilteredModelProviders,
						);
						if (!nextProvider) {
							break;
						}

						// Check and consume a rate-limit slot for the fallback candidate.
						// Using checkProviderRateLimit (not peek) so RPM/RPD counters include
						// requests routed to a provider via fallback, not just the initial pick.
						const retryRateLimitResult = await checkProviderRateLimit(
							project.organizationId,
							nextProvider.providerId,
							modelInfo.id,
						);
						if (retryRateLimitResult.rateLimited) {
							failedProviderIds.add(
								providerRetryKey(nextProvider.providerId, nextProvider.region),
							);
							// Mark as rate-limited in routing metadata
							const scoreEntry = routingMetadata?.providerScores.find(
								(s) => s.providerId === nextProvider.providerId,
							);
							if (scoreEntry) {
								scoreEntry.rate_limited = true;
							}
							// Don't consume a retry slot for rate-limit skips
							retryAttempt--;
							continue;
						}

						try {
							const ctx = await resolveProviderContextForRetry(
								nextProvider,
								true,
							);
							applyResolvedProviderContext(ctx);
						} catch {
							failedProviderIds.add(
								providerRetryKey(nextProvider.providerId, nextProvider.region),
							);
							// Don't consume a retry slot for context-resolution failures
							retryAttempt--;
							continue;
						}
					}

					try {
						const forwardedServiceTier = getForwardedServiceTier(
							usedInternalModel,
							usedProvider,
							usedRegion,
							service_tier,
							configIndex,
						);
						const headers = getProviderHeaders(usedProvider, usedToken, {
							requestId,
							webSearchEnabled: !!webSearchTool,
							serviceTier: forwardedServiceTier,
						});
						headers["Content-Type"] = "application/json";

						// Add the effort beta header whenever the outgoing body uses
						// Anthropic's effort-based reasoning fields — triggered by the
						// explicit `effort` param or by a `reasoning_effort` mapped onto an
						// adaptive model (Opus 4.7+).
						if (anthropicRequestNeedsEffortBeta(usedProvider, requestBody)) {
							const currentBeta = headers["anthropic-beta"];
							headers["anthropic-beta"] = currentBeta
								? `${currentBeta},effort-2025-11-24`
								: "effort-2025-11-24";
						}

						// Add structured outputs beta header for Anthropic if json_schema response_format is specified
						if (
							usedProvider === "anthropic" &&
							response_format?.type === "json_schema"
						) {
							const currentBeta = headers["anthropic-beta"];
							headers["anthropic-beta"] = currentBeta
								? `${currentBeta},structured-outputs-2025-11-13`
								: "structured-outputs-2025-11-13";
						}

						// For the Gemini Developer API the processing tier is a body
						// field; Vertex uses a header set above in getProviderHeaders.
						applyGoogleServiceTier(
							requestBody,
							usedProvider,
							forwardedServiceTier,
						);

						// Create a combined signal for both timeout and cancellation
						const fetchSignal = createStreamingCombinedSignal(
							requestCanBeCanceled ? controller : undefined,
							routingCfg,
						);

						res = await fetch(url, {
							method: "POST",
							headers,
							body: JSON.stringify(requestBody),
							signal: fetchSignal,
						});

						logServiceTierRequest(usedProvider, forwardedServiceTier, res);
						// AI Studio reports the served tier in a response header; Vertex
						// reports it later in usageMetadata.trafficType (set below).
						servedServiceTier = resolveServedServiceTier({
							serviceTierHeader: res?.headers.get("x-gemini-service-tier"),
						});
					} catch (error) {
						// Clean up the event listeners
						c.req.raw.signal.removeEventListener("abort", onAbort);

						// Check for timeout error first (AbortSignal.timeout throws TimeoutError)
						if (isTimeoutError(error)) {
							// Handle timeout error
							const errorMessage =
								error instanceof Error ? error.message : "Request timeout";
							const timeoutCause = extractErrorCause(error);
							logger.warn("Upstream request timeout", {
								error: errorMessage,
								cause: timeoutCause,
								usedProvider,
								requestedProvider,
								usedInternalModel,
								initialRequestedModel,
								unifiedFinishReason: getUnifiedFinishReason(
									"upstream_error",
									usedProvider,
								),
							});

							// Log the timeout error in the database
							const timeoutPluginIds = plugins?.map((p) => p.id) ?? [];

							let sameProviderRetryContext: Awaited<
								ReturnType<typeof resolveProviderContext>
							> | null = null;
							rememberFailedKey(usedProvider, usedRegion, {
								envVarName,
								configIndex,
								providerKeyId: providerKey?.id,
							});
							sameProviderRetryContext =
								await tryResolveAlternateKeyForCurrentProvider(true);

							// Check if we should retry before logging so we can mark the log as retried
							const willRetryTimeout = shouldRetryRequest({
								requestedProvider,
								noFallback,
								errorType: "upstream_timeout",
								retryCount: retryAttempt,
								remainingProviders:
									(routingMetadata?.providerScores.length ?? 0) -
									failedProviderIds.size -
									1,
								usedProvider,
								maxRetries: routingCfg.retry.maxRetries,
							});
							const willRetrySameProvider = sameProviderRetryContext !== null;
							const willRetryRequest =
								willRetrySameProvider || willRetryTimeout;

							const baseLogEntry = createLogEntry(
								requestId,
								project,
								apiKey,
								providerKey?.id,
								usedModelFormatted,
								usedModelMapping,
								usedProvider,
								initialRequestedModel,
								requestedProvider,
								messages,
								temperature,
								max_tokens,
								top_p,
								frequency_penalty,
								presence_penalty,
								reasoning_effort,
								reasoning_max_tokens,
								effort,
								response_format,
								tools,
								tool_choice,
								source,
								customHeaders,
								debugMode,
								userAgent,
								image_config,
								routingMetadata,
								rawBody,
								null, // No response for timeout error
								requestBody,
								null, // No upstream response for timeout error
								timeoutPluginIds,
								undefined, // No plugin results for error case
							);
							const attemptLogId = shortid();

							await insertLogEntry({
								...baseLogEntry,
								id: attemptLogId,
								duration: Date.now() - perAttemptStartTime,
								timeToFirstToken: null,
								timeToFirstReasoningToken: null,
								responseSize: 0,
								content: null,
								reasoningContent: null,
								finishReason: "upstream_error",
								promptTokens: null,
								completionTokens: null,
								totalTokens: null,
								reasoningTokens: null,
								cachedTokens: null,
								hasError: true,
								streamed: true,
								canceled: false,
								errorDetails: {
									statusCode: 0,
									statusText: "TimeoutError",
									responseText: errorMessage,
									cause: timeoutCause,
								},
								cachedInputCost: null,
								requestCost: null,
								webSearchCost: null,
								imageInputTokens: null,
								imageOutputTokens: null,
								imageInputCost: null,
								imageOutputCost: null,
								discount: null,
								dataStorageCost: "0",
								cached: false,
								toolResults: null,
								retried: willRetryRequest,
								retriedByLogId: willRetryRequest ? finalLogId : null,
							});

							if (willRetrySameProvider && sameProviderRetryContext) {
								routingAttempts.push(
									buildRoutingAttempt(
										usedProvider,
										usedInternalModel,
										0,
										getErrorType(0),
										false,
										{
											region: usedRegion,
											apiKeyHash: usedApiKeyHash,
											logId: attemptLogId,
										},
									),
								);
								applyResolvedProviderContext(sameProviderRetryContext);
								retryAttempt--;
								continue;
							}

							if (willRetryTimeout) {
								routingAttempts.push(
									buildRoutingAttempt(
										usedProvider,
										usedInternalModel,
										0,
										getErrorType(0),
										false,
										{
											region: usedRegion,
											apiKeyHash: usedApiKeyHash,
											logId: attemptLogId,
										},
									),
								);
								failedProviderIds.add(
									providerRetryKey(usedProvider, usedRegion),
								);
								continue;
							}

							await stream.writeSSE({
								event: "error",
								data: JSON.stringify({
									error: {
										message: `Upstream provider timeout: ${errorMessage}`,
										type: "upstream_timeout",
										code: "timeout",
									},
								}),
								id: String(eventId++),
							});
							return;
						} else if (error instanceof Error && error.name === "AbortError") {
							// Log the canceled request
							// Extract plugin IDs for logging (canceled request)
							const canceledPluginIds = plugins?.map((p) => p.id) ?? [];

							// Calculate costs for cancelled request if billing is enabled
							const billCancelled = shouldBillCancelledRequests();
							let cancelledCosts: Awaited<
								ReturnType<typeof calculateCosts>
							> | null = null;
							let estimatedPromptTokens: number | null = null;

							if (billCancelled) {
								// Estimate prompt tokens from messages
								const tokenEstimation = estimateTokens(
									usedProvider,
									messages,
									null,
									null,
									null,
								);
								estimatedPromptTokens = tokenEstimation.calculatedPromptTokens;

								// Calculate costs based on prompt tokens only (no completion yet)
								// If web search tool was enabled, count it as 1 search for billing
								cancelledCosts = await calculateCosts(
									usedInternalModel,
									usedProvider,
									usedRegion ?? null,
									estimatedPromptTokens,
									0, // No completion tokens yet
									null, // No cached tokens
									{
										prompt: messages
											.map((m) => messageContentToString(m.content))
											.join("\n"),
										completion: "",
									},
									null, // No reasoning tokens
									0, // No output images
									undefined,
									inputImageCount,
									webSearchTool ? 1 : null, // Bill for web search if it was enabled
									project.organizationId,
									undefined, // imageQuality
									null, // reportedImageInputTokens
									null, // reportedImageOutputTokens
									{ servedServiceTier },
								);
							}

							const baseLogEntry = createLogEntry(
								requestId,
								project,
								apiKey,
								providerKey?.id,
								usedModelFormatted,
								usedModelMapping,
								usedProvider,
								initialRequestedModel,
								requestedProvider,
								messages,
								temperature,
								max_tokens,
								top_p,
								frequency_penalty,
								presence_penalty,
								reasoning_effort,
								reasoning_max_tokens,
								effort,
								response_format,
								tools,
								tool_choice,
								source,
								customHeaders,
								debugMode,
								userAgent,
								image_config,
								routingMetadata,
								rawBody,
								null, // No response for canceled request
								requestBody, // The request that was sent before cancellation
								null, // No upstream response for canceled request
								canceledPluginIds,
								undefined, // No plugin results for canceled request
							);

							await insertLogEntry({
								...baseLogEntry,
								duration: Date.now() - perAttemptStartTime,
								timeToFirstToken: null, // Not applicable for canceled request
								timeToFirstReasoningToken: null, // Not applicable for canceled request
								responseSize: 0,
								content: null,
								reasoningContent: null,
								finishReason: "canceled",
								promptTokens: billCancelled
									? (
											cancelledCosts?.promptTokens ?? estimatedPromptTokens
										)?.toString()
									: null,
								completionTokens: billCancelled ? "0" : null,
								totalTokens: billCancelled
									? (
											cancelledCosts?.promptTokens ?? estimatedPromptTokens
										)?.toString()
									: null,
								reasoningTokens: null,
								cachedTokens: null,
								hasError: false,
								streamed: true,
								canceled: true,
								errorDetails: null,
								inputCost: cancelledCosts?.inputCost ?? null,
								outputCost: cancelledCosts?.outputCost ?? null,
								cachedInputCost: cancelledCosts?.cachedInputCost ?? null,
								requestCost: cancelledCosts?.requestCost ?? null,
								webSearchCost: cancelledCosts?.webSearchCost ?? null,
								imageInputTokens:
									cancelledCosts?.imageInputTokens?.toString() ?? null,
								imageOutputTokens:
									cancelledCosts?.imageOutputTokens?.toString() ?? null,
								imageInputCost: cancelledCosts?.imageInputCost ?? null,
								imageOutputCost: cancelledCosts?.imageOutputCost ?? null,
								audioInputTokens:
									cancelledCosts?.audioInputTokens?.toString() ?? null,
								audioInputCost: cancelledCosts?.audioInputCost ?? null,
								cost: cancelledCosts?.totalCost ?? null,
								estimatedCost: cancelledCosts?.estimatedCost ?? false,
								discount: cancelledCosts?.discount ?? null,
								dataStorageCost: billCancelled
									? calculateDataStorageCost(
											cancelledCosts?.promptTokens ?? estimatedPromptTokens,
											null,
											0,
											null,
											retentionLevel,
										)
									: "0",
								cached: false,
								toolResults: null,
							});

							// Send a cancellation event to the client
							await writeSSEAndCache({
								event: "canceled",
								data: JSON.stringify({
									message: "Request canceled by client",
								}),
								id: String(eventId++),
							});
							await writeSSEAndCache({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
							clearKeepalive();
							return;
						} else if (error instanceof Error) {
							// Handle fetch errors (timeout, connection failures, etc.)
							const errorMessage = error.message;
							const fetchCause = extractErrorCause(error);
							logger.warn("Fetch error", {
								error: errorMessage,
								cause: fetchCause,
								usedProvider,
								requestedProvider,
								usedInternalModel,
								initialRequestedModel,
								unifiedFinishReason: getUnifiedFinishReason(
									"upstream_error",
									usedProvider,
								),
							});

							// Log the error in the database
							// Extract plugin IDs for logging (fetch error)
							const fetchErrorPluginIds = plugins?.map((p) => p.id) ?? [];

							let sameProviderRetryContext: Awaited<
								ReturnType<typeof resolveProviderContext>
							> | null = null;
							if (isRetryableErrorType("network_error")) {
								rememberFailedKey(usedProvider, usedRegion, {
									envVarName,
									configIndex,
									providerKeyId: providerKey?.id,
								});
								sameProviderRetryContext =
									await tryResolveAlternateKeyForCurrentProvider(true);
							}

							// Check if we should retry before logging so we can mark the log as retried
							const willRetryFetch = shouldRetryRequest({
								requestedProvider,
								noFallback,
								errorType: "network_error",
								retryCount: retryAttempt,
								remainingProviders:
									(routingMetadata?.providerScores.length ?? 0) -
									failedProviderIds.size -
									1,
								usedProvider,
								maxRetries: routingCfg.retry.maxRetries,
							});
							const willRetrySameProvider = sameProviderRetryContext !== null;
							const willRetryRequest = willRetrySameProvider || willRetryFetch;

							const baseLogEntry = createLogEntry(
								requestId,
								project,
								apiKey,
								providerKey?.id,
								usedModelFormatted,
								usedModelMapping,
								usedProvider,
								initialRequestedModel,
								requestedProvider,
								messages,
								temperature,
								max_tokens,
								top_p,
								frequency_penalty,
								presence_penalty,
								reasoning_effort,
								reasoning_max_tokens,
								effort,
								response_format,
								tools,
								tool_choice,
								source,
								customHeaders,
								debugMode,
								userAgent,
								image_config,
								routingMetadata,
								rawBody,
								null, // No response for fetch error
								requestBody, // The request that resulted in error
								null, // No upstream response for fetch error
								fetchErrorPluginIds,
								undefined, // No plugin results for error case
							);
							const attemptLogId = shortid();

							await insertLogEntry({
								...baseLogEntry,
								id: attemptLogId,
								duration: Date.now() - perAttemptStartTime,
								timeToFirstToken: null, // Not applicable for error case
								timeToFirstReasoningToken: null, // Not applicable for error case
								responseSize: 0,
								content: null,
								reasoningContent: null,
								finishReason: "upstream_error",
								promptTokens: null,
								completionTokens: null,
								totalTokens: null,
								reasoningTokens: null,
								cachedTokens: null,
								hasError: true,
								streamed: true,
								canceled: false,
								errorDetails: {
									statusCode: 0,
									statusText: error.name,
									responseText: errorMessage,
									cause: fetchCause,
								},
								cachedInputCost: null,
								requestCost: null,
								webSearchCost: null,
								imageInputTokens: null,
								imageOutputTokens: null,
								imageInputCost: null,
								imageOutputCost: null,
								discount: null,
								dataStorageCost: "0",
								cached: false,
								toolResults: null,
								retried: willRetryRequest,
								retriedByLogId: willRetryRequest ? finalLogId : null,
							});

							// Report key health for the selected token source
							if (envVarName !== undefined) {
								reportKeyError(
									envVarName,
									configIndex,
									0,
									undefined,
									usedInternalModel,
								);
							}
							if (trackedKeyHealthId) {
								reportTrackedKeyError(
									trackedKeyHealthId,
									0,
									undefined,
									usedInternalModel,
								);
							}

							if (willRetrySameProvider && sameProviderRetryContext) {
								routingAttempts.push(
									buildRoutingAttempt(
										usedProvider,
										usedInternalModel,
										0,
										getErrorType(0),
										false,
										{
											region: usedRegion,
											apiKeyHash: usedApiKeyHash,
											logId: attemptLogId,
										},
									),
								);
								applyResolvedProviderContext(sameProviderRetryContext);
								retryAttempt--;
								continue;
							}

							if (willRetryFetch) {
								routingAttempts.push(
									buildRoutingAttempt(
										usedProvider,
										usedInternalModel,
										0,
										getErrorType(0),
										false,
										{
											region: usedRegion,
											apiKeyHash: usedApiKeyHash,
											logId: attemptLogId,
										},
									),
								);
								failedProviderIds.add(
									providerRetryKey(usedProvider, usedRegion),
								);
								continue;
							}

							// Send error event to the client
							await writeSSEAndCache({
								event: "error",
								data: JSON.stringify({
									error: {
										message: `Failed to connect to provider: ${errorMessage}`,
										type: "upstream_error",
										code: "fetch_failed",
									},
								}),
								id: String(eventId++),
							});
							await writeSSEAndCache({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
							clearKeepalive();
							return;
						} else {
							throw error;
						}
					}

					if (!res.ok) {
						const rawErrorResponseText = await res.text();
						const errorResponseText =
							usedProvider === "aws-bedrock"
								? extractAwsBedrockHttpError(res, rawErrorResponseText)
								: rawErrorResponseText;

						// If the upstream Google provider rejected the document MIME,
						// surface a typed error event so streaming clients see the same
						// clean shape as the non-streaming path does (via app.onError).
						const documentErr = hasDocuments
							? parseGoogleUpstreamDocumentError(
									errorResponseText,
									usedProvider,
								)
							: null;

						// Determine the finish reason for error handling
						const finishReason = getFinishReasonFromError(
							res.status,
							errorResponseText,
						);

						if (
							finishReason !== "client_error" &&
							finishReason !== "content_filter"
						) {
							logger.warn("Provider error", {
								status: res.status,
								errorText: errorResponseText,
								usedProvider,
								requestedProvider,
								usedInternalModel,
								initialRequestedModel,
								organizationId: project.organizationId,
								projectId: apiKey.projectId,
								apiKeyId: apiKey.id,
								unifiedFinishReason: getUnifiedFinishReason(
									finishReason,
									usedProvider,
								),
							});
						}

						// Log the request in the database
						// Extract plugin IDs for logging
						const streamingErrorPluginIds = plugins?.map((p) => p.id) ?? [];

						let sameProviderRetryContext: Awaited<
							ReturnType<typeof resolveProviderContext>
						> | null = null;
						if (
							shouldRetryAlternateKey(
								finishReason,
								res.status,
								errorResponseText,
							)
						) {
							rememberFailedKey(usedProvider, usedRegion, {
								envVarName,
								configIndex,
								providerKeyId: providerKey?.id,
							});
							sameProviderRetryContext =
								await tryResolveAlternateKeyForCurrentProvider(true);
						}

						// Check if we should retry before logging so we can mark the log as retried
						const willRetryHttpError = shouldRetryRequest({
							requestedProvider,
							noFallback,
							errorType: finishReason,
							retryCount: retryAttempt,
							remainingProviders:
								(routingMetadata?.providerScores.length ?? 0) -
								failedProviderIds.size -
								1,
							usedProvider,
							maxRetries: routingCfg.retry.maxRetries,
						});
						const willRetrySameProvider = sameProviderRetryContext !== null;
						const willRetryRequest =
							willRetrySameProvider || willRetryHttpError;

						const baseLogEntry = createLogEntry(
							requestId,
							project,
							apiKey,
							providerKey?.id,
							usedModelFormatted,
							usedModelMapping,
							usedProvider,
							initialRequestedModel,
							requestedProvider,
							messages,
							temperature,
							max_tokens,
							top_p,
							frequency_penalty,
							presence_penalty,
							reasoning_effort,
							reasoning_max_tokens,
							effort,
							response_format,
							tools,
							tool_choice,
							source,
							customHeaders,
							debugMode,
							userAgent,
							image_config,
							routingMetadata,
							rawBody,
							null, // No response for error case
							requestBody, // The request that was sent and resulted in error
							null, // No upstream response for error case
							streamingErrorPluginIds,
							undefined, // No plugin results for error case
						);
						const attemptLogId = shortid();

						const contentFilterPromptTokens =
							finishReason === "content_filter"
								? (estimateTokens(usedProvider, messages, null, null, 0)
										.calculatedPromptTokens ?? null)
								: null;
						const contentFilterCosts =
							finishReason === "content_filter"
								? await calculateCosts(
										usedInternalModel,
										usedProvider,
										usedRegion ?? null,
										Math.max(1, Math.round(contentFilterPromptTokens ?? 1)),
										0,
										null,
										{
											prompt: messages
												.map((m) => messageContentToString(m.content))
												.join("\n"),
											completion: "",
										},
										null,
										0,
										image_config?.image_size,
										inputImageCount,
										0,
										project.organizationId,
										image_config?.image_quality,
										null,
										null,
										{ servedServiceTier },
										true,
									)
								: null;

						await insertLogEntry({
							...baseLogEntry,
							id: attemptLogId,
							duration: Date.now() - perAttemptStartTime,
							timeToFirstToken: null,
							timeToFirstReasoningToken: null,
							responseSize: errorResponseText.length,
							content: null,
							reasoningContent: null,
							finishReason,
							promptTokens: contentFilterPromptTokens?.toString() ?? null,
							completionTokens: null,
							totalTokens: contentFilterPromptTokens?.toString() ?? null,
							reasoningTokens: null,
							cachedTokens: null,
							hasError: finishReason !== "content_filter", // content_filter is not an error
							streamed: true,
							canceled: false,
							errorDetails:
								finishReason === "content_filter"
									? null
									: {
											statusCode: res.status,
											statusText: res.statusText,
											responseText: errorResponseText,
										},
							cost: contentFilterCosts?.totalCost ?? null,
							inputCost: contentFilterCosts?.inputCost ?? null,
							outputCost: contentFilterCosts?.outputCost ?? null,
							cachedInputCost: contentFilterCosts?.cachedInputCost ?? null,
							requestCost: contentFilterCosts?.requestCost ?? null,
							webSearchCost: contentFilterCosts?.webSearchCost ?? null,
							contentFilterCost: contentFilterCosts?.contentFilterCost ?? null,
							imageInputTokens: null,
							imageOutputTokens: null,
							imageInputCost: contentFilterCosts?.imageInputCost ?? null,
							imageOutputCost: contentFilterCosts?.imageOutputCost ?? null,
							discount: contentFilterCosts?.discount ?? null,
							dataStorageCost: "0",
							cached: false,
							toolResults: null,
							retried: willRetryRequest,
							retriedByLogId: willRetryRequest ? finalLogId : null,
						});

						// Report key health for the selected token source
						// Don't report content_filter as a key error - it's intentional provider behavior
						if (envVarName !== undefined && finishReason !== "content_filter") {
							reportKeyError(
								envVarName,
								configIndex,
								res.status,
								errorResponseText,
								usedInternalModel,
							);
						}
						if (trackedKeyHealthId && finishReason !== "content_filter") {
							reportTrackedKeyError(
								trackedKeyHealthId,
								res.status,
								errorResponseText,
								usedInternalModel,
							);
						}

						if (willRetrySameProvider && sameProviderRetryContext) {
							routingAttempts.push(
								buildRoutingAttempt(
									usedProvider,
									usedInternalModel,
									res.status,
									getErrorType(res.status),
									false,
									{
										region: usedRegion,
										apiKeyHash: usedApiKeyHash,
										logId: attemptLogId,
									},
								),
							);
							applyResolvedProviderContext(sameProviderRetryContext);
							retryAttempt--;
							continue;
						}

						if (willRetryHttpError) {
							routingAttempts.push(
								buildRoutingAttempt(
									usedProvider,
									usedInternalModel,
									res.status,
									getErrorType(res.status),
									false,
									{
										region: usedRegion,
										apiKeyHash: usedApiKeyHash,
										logId: attemptLogId,
									},
								),
							);
							failedProviderIds.add(providerRetryKey(usedProvider, usedRegion));
							continue;
						}

						// For content_filter, return a proper completion chunk (not an error)
						// This handles Azure ResponsibleAIPolicyViolation and similar content filtering errors
						if (finishReason === "content_filter") {
							await writeStreamingContentFilterResponse({
								billingModel: usedInternalModel,
								billingProvider: usedProvider,
								billingRegion: usedRegion ?? null,
								responseModel: formatUsedModelForDisplay(
									usedProvider,
									usedInternalModel,
									customProviderName,
									usedRegion,
								),
								metadata: {
									requested_model: initialRequestedModel,
									requested_provider: requestedProvider,
									used_model: usedInternalModel,
									used_provider: usedProvider,
									...(usedRegion && { used_region: usedRegion }),
									underlying_used_model: usedInternalModel,
								},
							});
						} else {
							// For client errors, return the original provider error response
							let errorData;
							if (documentErr) {
								errorData = {
									error: {
										message: documentErr.message,
										type: "invalid_request_error",
										param: null,
										code: "unsupported_document_format",
										mimeType: documentErr.mimeType,
										providerTarget: documentErr.providerTarget,
									},
								};
							} else if (finishReason === "client_error") {
								try {
									errorData = JSON.parse(errorResponseText);
								} catch {
									// If we can't parse the original error, fall back to our format
									errorData = {
										error: {
											message: `Error from provider ${usedProvider}: ${res.status} ${res.statusText} ${errorResponseText}`,
											type: finishReason,
											param: null,
											code: finishReason,
											responseText: errorResponseText,
										},
									};
								}
							} else {
								errorData = {
									error: {
										message: `Error from provider ${usedProvider}: ${res.status} ${res.statusText} ${errorResponseText}`,
										type: finishReason,
										param: null,
										code: finishReason,
										responseText: errorResponseText,
									},
								};
							}

							await writeSSEAndCache({
								event: "error",
								data: JSON.stringify(errorData),
								id: String(eventId++),
							});
							await writeSSEAndCache({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
						}

						clearKeepalive();
						return;
					}

					const inspectedStreamingResponse =
						await inspectImmediateStreamingProviderError(res, usedProvider);
					res = inspectedStreamingResponse.response;
					if (inspectedStreamingResponse.immediateError) {
						const {
							errorCode,
							errorMessage,
							errorResponseText,
							errorType,
							inferredStatusCode,
							statusText,
						} = inspectedStreamingResponse.immediateError;

						logger.warn("Immediate streaming provider error", {
							status: inferredStatusCode,
							errorText: errorResponseText,
							usedProvider,
							requestedProvider,
							usedInternalModel,
							initialRequestedModel,
							organizationId: project.organizationId,
							projectId: apiKey.projectId,
							apiKeyId: apiKey.id,
							unifiedFinishReason: getUnifiedFinishReason(
								errorType,
								usedProvider,
							),
						});

						const streamingErrorPluginIds = plugins?.map((p) => p.id) ?? [];

						let sameProviderRetryContext: Awaited<
							ReturnType<typeof resolveProviderContext>
						> | null = null;
						if (
							shouldRetryAlternateKey(
								errorType,
								inferredStatusCode,
								errorResponseText,
							)
						) {
							rememberFailedKey(usedProvider, usedRegion, {
								envVarName,
								configIndex,
								providerKeyId: providerKey?.id,
							});
							sameProviderRetryContext =
								await tryResolveAlternateKeyForCurrentProvider(true);
						}

						const willRetryStreamingError = shouldRetryRequest({
							requestedProvider,
							noFallback,
							errorType,
							retryCount: retryAttempt,
							remainingProviders:
								(routingMetadata?.providerScores.length ?? 0) -
								failedProviderIds.size -
								1,
							usedProvider,
							maxRetries: routingCfg.retry.maxRetries,
						});
						const willRetrySameProvider = sameProviderRetryContext !== null;
						const willRetryRequest =
							willRetrySameProvider || willRetryStreamingError;

						const baseLogEntry = createLogEntry(
							requestId,
							project,
							apiKey,
							providerKey?.id,
							usedModelFormatted,
							usedModelMapping,
							usedProvider,
							initialRequestedModel,
							requestedProvider,
							messages,
							temperature,
							max_tokens,
							top_p,
							frequency_penalty,
							presence_penalty,
							reasoning_effort,
							reasoning_max_tokens,
							effort,
							response_format,
							tools,
							tool_choice,
							source,
							customHeaders,
							debugMode,
							userAgent,
							image_config,
							routingMetadata,
							rawBody,
							null,
							requestBody,
							null,
							streamingErrorPluginIds,
							undefined,
						);
						const attemptLogId = shortid();

						await insertLogEntry({
							...baseLogEntry,
							id: attemptLogId,
							duration: Date.now() - perAttemptStartTime,
							timeToFirstToken: null,
							timeToFirstReasoningToken: null,
							responseSize: errorResponseText.length,
							content: null,
							reasoningContent: null,
							finishReason: errorType,
							promptTokens: null,
							completionTokens: null,
							totalTokens: null,
							reasoningTokens: null,
							cachedTokens: null,
							hasError: errorType !== "content_filter",
							streamed: true,
							canceled: false,
							errorDetails:
								errorType === "content_filter"
									? null
									: {
											statusCode: inferredStatusCode,
											statusText,
											responseText: errorResponseText,
										},
							cachedInputCost: null,
							requestCost: null,
							webSearchCost: null,
							imageInputTokens: null,
							imageOutputTokens: null,
							imageInputCost: null,
							imageOutputCost: null,
							discount: null,
							dataStorageCost: "0",
							cached: false,
							toolResults: null,
							retried: willRetryRequest,
							retriedByLogId: willRetryRequest ? finalLogId : null,
						});

						if (envVarName !== undefined && errorType !== "content_filter") {
							reportKeyError(
								envVarName,
								configIndex,
								inferredStatusCode,
								errorResponseText,
								usedInternalModel,
							);
						}
						if (trackedKeyHealthId && errorType !== "content_filter") {
							reportTrackedKeyError(
								trackedKeyHealthId,
								inferredStatusCode,
								errorResponseText,
								usedInternalModel,
							);
						}

						if (willRetrySameProvider && sameProviderRetryContext) {
							routingAttempts.push(
								buildRoutingAttempt(
									usedProvider,
									usedInternalModel,
									inferredStatusCode,
									getErrorType(inferredStatusCode),
									false,
									{
										region: usedRegion,
										apiKeyHash: usedApiKeyHash,
										logId: attemptLogId,
									},
								),
							);
							applyResolvedProviderContext(sameProviderRetryContext);
							retryAttempt--;
							continue;
						}

						if (willRetryStreamingError) {
							routingAttempts.push(
								buildRoutingAttempt(
									usedProvider,
									usedInternalModel,
									inferredStatusCode,
									getErrorType(inferredStatusCode),
									false,
									{
										region: usedRegion,
										apiKeyHash: usedApiKeyHash,
										logId: attemptLogId,
									},
								),
							);
							failedProviderIds.add(providerRetryKey(usedProvider, usedRegion));
							continue;
						}

						await writeSSEAndCache({
							event: "error",
							data: JSON.stringify({
								error: {
									message: errorMessage,
									type: errorType,
									code: errorCode,
									param: null,
									responseText: errorResponseText,
								},
							}),
							id: String(eventId++),
						});
						await writeSSEAndCache({
							event: "done",
							data: "[DONE]",
							id: String(eventId++),
						});
						clearKeepalive();
						return;
					}

					break; // Fetch succeeded, exit retry loop
				} // End of retry for loop

				// Add the final attempt (successful or last failed) to routing
				if (res && res.ok && usedProvider) {
					routingAttempts.push(
						buildRoutingAttempt(
							usedProvider,
							usedInternalModel,
							res.status,
							"none",
							true,
							{
								region: usedRegion,
								apiKeyHash: usedApiKeyHash,
								logId: finalLogId,
							},
						),
					);
				}

				// Update routingMetadata with all routing attempts for DB logging
				if (routingMetadata) {
					// Enrich providerScores with failure info from routing attempts
					const failedMap = new Map(
						routingAttempts
							.filter((a) => !a.succeeded)
							.map((f) => [f.provider, f]),
					);
					routingMetadata = {
						...routingMetadata,
						routing: routingAttempts,
						providerScores: routingMetadata.providerScores.map((score) => {
							const failure = failedMap.get(score.providerId);
							if (failure) {
								return {
									...score,
									failed: true,
									status_code: failure.status_code,
									error_type: failure.error_type,
								};
							}
							return score;
						}),
					};
				}

				// If all retries exhausted without a successful response
				if (!res || !res.ok) {
					await writeSSEAndCache({
						event: "error",
						data: JSON.stringify({
							error: {
								message: "All provider attempts failed",
								type: "upstream_error",
								code: "all_providers_failed",
							},
						}),
						id: String(eventId++),
					});
					await writeSSEAndCache({
						event: "done",
						data: "[DONE]",
						id: String(eventId++),
					});
					clearKeepalive();
					return;
				}

				// After retry loop: narrow provider variables for the rest of the streaming body
				if (
					!usedProvider ||
					!usedToken ||
					!url ||
					!usedModelFormatted ||
					!usedModelMapping
				) {
					throw new Error("Provider context not initialized");
				}

				if (!res.body) {
					await writeSSEAndCache({
						event: "error",
						data: JSON.stringify({
							error: {
								message: "No response body from provider",
								type: "gateway_error",
								param: null,
								code: "gateway_error",
							},
						}),
						id: String(eventId++),
					});
					await writeSSEAndCache({
						event: "done",
						data: "[DONE]",
						id: String(eventId++),
					});
					clearKeepalive();
					return;
				}

				const reader = res.body.getReader();
				let fullContent = "";
				let fullReasoningContent = "";
				let finishReason = null;
				let promptTokens = null;
				let completionTokens = null;
				let totalTokens = null;
				let reasoningTokens = null;
				let cachedTokens = null;
				let cacheCreationTokens: number | null = null;
				let cacheCreation5mTokens: number | null = null;
				let cacheCreation1hTokens: number | null = null;
				let audioInputTokens: number | null = null;
				let cachedAudioInputTokens: number | null = null;
				let streamingToolCalls = null;
				let imageByteSize = 0; // Track total image data size for token estimation
				let outputImageCount = 0; // Track number of output images for cost calculation
				let webSearchCount = 0; // Track web search calls for cost calculation
				const serverToolUseIndices = new Set<number>(); // Track Anthropic server_tool_use block indices
				let sawUpstreamDoneSentinel = false;
				let sawProviderTerminalEvent = false;
				let sawOpenAiResponsesDoneEvent = false;
				let sawOpenAiResponsesCompletedStatus = false;
				let sentDownstreamFinishReasonChunk = false;
				let handledTerminalProviderEvent = false;
				let buffer = ""; // Buffer for accumulating partial data across chunks (string for SSE)
				let binaryBuffer = new Uint8Array(0); // Buffer for binary event streams (AWS Bedrock)
				let rawUpstreamData = ""; // Raw data received from upstream provider
				// Raw upstream chunk that carried a finish_reason signalling an upstream
				// failure (e.g. "error"), preserved so the log shows the actual provider
				// payload rather than only our synthesized error message.
				let upstreamErrorChunkRaw: string | null = null;
				const isAwsBedrock = usedProvider === "aws-bedrock";
				const taggedReasoningStreamState = {
					inReasoning: false,
					pending: "",
				};
				let shouldTerminateStream = false;

				// Response healing for streaming mode
				const streamingResponseHealingEnabled = plugins?.some(
					(p) => p.id === "response-healing",
				);
				const streamingIsJsonResponseFormat =
					response_format?.type === "json_object" ||
					response_format?.type === "json_schema";
				// Healing buffers a single content stream and replays it after
				// repair. With n > 1 each choice has its own content stream, so
				// the single buffer would corrupt multi-choice output. Skip
				// healing in that case — JSON healing for multi-choice streams
				// is deferred to a follow-up.
				const healingDisabledByN = n !== undefined && n > 1;
				const shouldBufferForHealing =
					!healingDisabledByN &&
					streamingIsJsonResponseFormat &&
					(streamingResponseHealingEnabled === true ||
						((usedProvider === "anthropic" ||
							usedProvider === "vertex-anthropic") &&
							response_format?.type === "json_object") ||
						(usedProvider === "aws-bedrock" &&
							response_format?.type === "json_object") ||
						usedProvider === "novita" ||
						splitTaggedReasoning ||
						healStreamingJsonOutput);

				// Buffer for storing chunks when healing is enabled
				// We need to buffer content, track last chunk info, and replay healed content at the end
				const bufferedContentChunks: string[] = [];
				let lastChunkId: string | null = null;
				let lastChunkModel: string | null = null;
				let lastChunkCreated: number | null = null;
				const streamingPluginResults: {
					responseHealing?: {
						healed: boolean;
						healingMethod?: string;
					};
				} = {};

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}

						// For AWS Bedrock, convert binary event stream to SSE format
						let chunk: string;
						if (isAwsBedrock) {
							// Append binary data to buffer
							const newBuffer = new Uint8Array(
								binaryBuffer.length + value.length,
							);
							newBuffer.set(binaryBuffer);
							newBuffer.set(value, binaryBuffer.length);
							binaryBuffer = newBuffer;

							// Parse and convert available events
							const { sse, bytesConsumed } =
								convertAwsEventStreamToSSE(binaryBuffer);
							chunk = sse;

							// Remove consumed bytes from binary buffer
							if (bytesConsumed > 0) {
								binaryBuffer = binaryBuffer.slice(bytesConsumed);
							}
						} else {
							// Convert the Uint8Array to a string for SSE
							chunk = sharedTextDecoder.decode(value, { stream: true });
						}

						// Log error on large chunks (1MB+) - should almost never happen
						if (chunk.length > 1024 * 1024) {
							logger.error(
								`Large chunk received: ${(chunk.length / 1024 / 1024).toFixed(2)}MB`,
							);
						}

						buffer += chunk;
						// Collect raw upstream data for logging only in debug mode and within size limit
						if (debugMode && rawUpstreamData.length < MAX_RAW_DATA_SIZE) {
							rawUpstreamData += chunk;
						}

						// Check buffer size to prevent memory exhaustion
						if (buffer.length > MAX_BUFFER_SIZE) {
							const bufferSizeMB = MAX_BUFFER_SIZE / 1024 / 1024;
							logger.error(
								`Buffer size exceeded ${bufferSizeMB}MB limit, aborting stream`,
							);

							// Send error to client
							try {
								await stream.writeSSE({
									event: "error",
									data: JSON.stringify({
										error: {
											message: `Streaming buffer exceeded ${bufferSizeMB}MB limit`,
											type: "gateway_error",
											param: null,
											code: "buffer_overflow",
										},
									}),
									id: String(eventId++),
								});
								await stream.writeSSE({
									event: "done",
									data: "[DONE]",
									id: String(eventId++),
								});
								doneSent = true;
							} catch (sseError) {
								logger.error(
									"Failed to send buffer overflow error SSE",
									sseError instanceof Error
										? sseError
										: new Error(String(sseError)),
								);
							}

							// Set error for logging
							streamingError = {
								message: `Streaming buffer exceeded ${bufferSizeMB}MB limit`,
								type: "buffer_overflow",
								code: "buffer_overflow",
								details: {
									bufferSize: buffer.length,
									maxBufferSize: MAX_BUFFER_SIZE,
									provider: usedProvider,
									model: usedInternalModel,
								},
							};

							break;
						}

						// Process SSE events from buffer
						let processedLength = 0;
						const bufferCopy = buffer;

						// Look for complete SSE events, handling events at buffer start
						let searchStart = 0;
						while (searchStart < bufferCopy.length) {
							// Find "data: " - could be at start of buffer or after newline
							let dataIndex = -1;

							if (searchStart === 0 && bufferCopy.startsWith("data: ")) {
								// Event at buffer start
								dataIndex = 0;
							} else {
								// Look for "\ndata: " pattern
								const newlineDataIndex = bufferCopy.indexOf(
									"\ndata: ",
									searchStart,
								);
								if (newlineDataIndex !== -1) {
									dataIndex = newlineDataIndex + 1; // Skip the newline
								}
							}

							if (dataIndex === -1) {
								break;
							}

							// Find the end of this SSE event
							// Look for next event or proper event termination
							let eventEnd = -1;

							// First, look for the next "data: " event (after a newline)
							const nextEventIndex = bufferCopy.indexOf(
								"\ndata: ",
								dataIndex + 6,
							);
							if (nextEventIndex !== -1) {
								// Found next data event, but we still need to check if there are SSE fields in between
								// For Anthropic, we might have: data: {...}\n\nevent: something\n\ndata: {...}
								const betweenEvents = bufferCopy.slice(
									dataIndex + 6,
									nextEventIndex,
								);
								const firstNewline = betweenEvents.indexOf("\n");

								if (firstNewline !== -1) {
									// Check if JSON up to first newline is valid
									const jsonCandidate = betweenEvents
										.slice(0, firstNewline)
										.trim();
									// Quick heuristic check before expensive JSON.parse
									let isValidJson = false;
									if (mightBeCompleteJson(jsonCandidate)) {
										try {
											JSON.parse(jsonCandidate);
											isValidJson = true;
										} catch {
											// JSON is not complete
										}
									}
									if (isValidJson) {
										// JSON is valid - end at first newline to exclude SSE fields
										eventEnd = dataIndex + 6 + firstNewline;
									} else {
										// JSON is not complete, use the full segment to next data event
										eventEnd = nextEventIndex;
									}
								} else {
									// No newline found, use full segment
									eventEnd = nextEventIndex;
								}
							} else {
								// No next event found - check for proper event termination
								// SSE events should end with at least one newline
								const eventStartPos = dataIndex + 6; // Start of event data

								// For Anthropic SSE format, we need to be more careful about event boundaries
								// Try to find the end of the JSON data by looking for the closing brace
								const newlinePos = bufferCopy.indexOf("\n", eventStartPos);
								if (newlinePos !== -1) {
									// We found a newline - check if the JSON before it is valid
									const jsonCandidate = bufferCopy
										.slice(eventStartPos, newlinePos)
										.trim();
									// Quick heuristic check before expensive JSON.parse
									let isValidJson = false;
									if (mightBeCompleteJson(jsonCandidate)) {
										try {
											JSON.parse(jsonCandidate);
											isValidJson = true;
										} catch {
											// JSON is not complete
										}
									}
									if (isValidJson) {
										// JSON is valid - this newline marks the end of our data
										eventEnd = newlinePos;
									} else {
										// JSON is not valid, check if there's more content after the newline
										if (newlinePos + 1 >= bufferCopy.length) {
											// Newline is at the end of buffer - event is incomplete
											break;
										} else {
											// There's content after the newline
											// Check if it's another SSE field (like event:, id:, retry:, etc.) or if the event continues
											const restOfBuffer = bufferCopy.slice(newlinePos + 1);

											// Check for SSE field patterns (event:, id:, retry:, etc.)
											// Skip leading newlines efficiently without creating new strings
											let trimStart = 0;
											while (
												trimStart < restOfBuffer.length &&
												restOfBuffer[trimStart] === "\n"
											) {
												trimStart++;
											}

											if (
												restOfBuffer.startsWith("\n") || // Empty line - end of event
												restOfBuffer.startsWith("data: ") // Next data field
											) {
												// This is the end of our data event
												eventEnd = newlinePos;
											} else if (trimStart > 0) {
												// Had leading newlines - check for SSE fields after them
												const afterNewlines = restOfBuffer.substring(trimStart);
												if (
													afterNewlines.startsWith("event:") ||
													afterNewlines.startsWith("id:") ||
													afterNewlines.startsWith("retry:") ||
													SSE_FIELD_PATTERN.test(afterNewlines)
												) {
													eventEnd = newlinePos;
												} else {
													// Content continues on next line - use full buffer
													eventEnd = bufferCopy.length;
												}
											} else {
												// No leading newlines - check SSE field directly
												if (SSE_FIELD_PATTERN.test(restOfBuffer)) {
													eventEnd = newlinePos;
												} else {
													// Content continues on next line - use full buffer
													eventEnd = bufferCopy.length;
												}
											}
										}
									}
								} else {
									// No newline found after event data - event is incomplete
									// Try to detect if we have a complete JSON object
									const eventDataCandidate = bufferCopy.slice(eventStartPos);
									if (eventDataCandidate.length > 0) {
										// Quick heuristic check before expensive JSON.parse
										const trimmedCandidate = eventDataCandidate.trim();
										if (mightBeCompleteJson(trimmedCandidate)) {
											try {
												JSON.parse(trimmedCandidate);
												// If we can parse it, it's complete
												eventEnd = bufferCopy.length;
											} catch {
												// JSON parsing failed - event is incomplete
												break;
											}
										} else {
											// Heuristic says incomplete - don't bother parsing
											break;
										}
									} else {
										// No event data yet
										break;
									}
								}
							}

							const eventData = bufferCopy
								.slice(dataIndex + 6, eventEnd)
								.trim();

							// Debug logging for troublesome events
							// Only scan for SSE field contamination on small events to avoid
							// O(n) scans on multi-MB payloads (e.g. base64 image data).
							// Large events (>64KB) are almost always valid image/binary data.
							if (
								eventData.length < 65536 &&
								(eventData.includes("event:") || eventData.includes("id:"))
							) {
								logger.warn("Event data contains SSE field", {
									eventData:
										eventData.substring(0, 200) +
										(eventData.length > 200 ? "..." : ""),
									dataIndex,
									eventEnd,
									bufferLength: bufferCopy.length,
									provider: usedProvider,
								});
							}

							if (eventData === "[DONE]") {
								sawUpstreamDoneSentinel = true;
								// Set default finish_reason if not provided by the stream
								// Some providers (like Novita) don't send finish_reason in streaming chunks
								if (finishReason === null) {
									// Default to "stop" unless we have tool calls
									finishReason =
										streamingToolCalls && streamingToolCalls.length > 0
											? "tool_calls"
											: "stop";
								}

								// Calculate final usage if we don't have complete data
								let finalPromptTokens = promptTokens;
								let finalCompletionTokens = completionTokens;
								let finalTotalTokens = totalTokens;

								// Estimate missing tokens if needed using helper function
								if (finalPromptTokens === null || finalPromptTokens === 0) {
									const estimation = estimateTokens(
										usedProvider,
										messages,
										null,
										null,
										null,
									);
									finalPromptTokens = estimation.calculatedPromptTokens;
								}

								if (finalCompletionTokens === null) {
									const textTokens = estimateTokensFromContent(fullContent);
									// For images, estimate ~258 tokens per image + 1 token per 750 bytes
									// This is based on Google's image token calculation
									let imageTokens = 0;
									if (imageByteSize > 0) {
										// Base tokens per image (258) + additional tokens based on size
										imageTokens = 258 + Math.ceil(imageByteSize / 750);
									}
									finalCompletionTokens = textTokens + imageTokens;
								}

								if (finalTotalTokens === null) {
									finalTotalTokens =
										(finalPromptTokens ?? 0) +
										(finalCompletionTokens ?? 0) +
										(reasoningTokens ?? 0);
								}

								// Send final usage chunk before [DONE] if we have any usage data
								if (
									finalPromptTokens !== null ||
									finalCompletionTokens !== null ||
									finalTotalTokens !== null
								) {
									// Calculate costs for streaming response
									const streamingCosts = await calculateCosts(
										usedInternalModel,
										usedProvider,
										usedRegion ?? null,
										finalPromptTokens,
										finalCompletionTokens,
										cachedTokens,
										{
											prompt: messages
												.map((m) => messageContentToString(m.content))
												.join("\n"),
											completion: fullContent,
											toolResults: streamingToolCalls ?? undefined,
										},
										reasoningTokens,
										outputImageCount,
										image_config?.image_size,
										inputImageCount,
										webSearchCount,
										project.organizationId,
										image_config?.image_quality,
										null,
										null,
										{
											cacheWriteTokens: cacheCreationTokens,
											cacheWrite1hTokens: cacheCreation1hTokens,
											audioInputTokens,
											cachedAudioInputTokens,
											explicitCacheUsed,
											servedServiceTier,
										},
									);
									streamingCosts.dataStorageCost = toDataStorageCostNumber(
										streamingCosts.promptTokens ?? finalPromptTokens,
										cachedTokens,
										streamingCosts.completionTokens ?? finalCompletionTokens,
										reasoningTokens,
										retentionLevel,
									);

									// Include costs in response for all users
									const shouldIncludeCosts = true;

									const finalStreamUsage: Record<string, any> = {
										prompt_tokens: Math.max(
											1,
											streamingCosts.promptTokens ?? finalPromptTokens ?? 1,
										),
										completion_tokens:
											streamingCosts.completionTokens ??
											finalCompletionTokens ??
											0,
										total_tokens: Math.max(
											1,
											(streamingCosts.promptTokens ?? finalPromptTokens ?? 0) +
												(streamingCosts.completionTokens ??
													finalCompletionTokens ??
													0) +
												(reasoningTokens ?? 0),
										),
										...(reasoningTokens !== null &&
											reasoningTokens > 0 && {
												reasoning_tokens: reasoningTokens,
											}),
										...((cachedTokens !== null ||
											(cacheCreationTokens !== null &&
												cacheCreationTokens > 0)) && {
											prompt_tokens_details: {
												cached_tokens: cachedTokens ?? 0,
												...(cacheCreationTokens !== null &&
													cacheCreationTokens > 0 && {
														cache_creation_tokens: cacheCreationTokens,
													}),
												...(cacheCreationTokens !== null &&
													cacheCreationTokens > 0 &&
													(cacheCreation5mTokens !== null ||
														cacheCreation1hTokens !== null) && {
														cache_creation: {
															ephemeral_5m_input_tokens:
																cacheCreation5mTokens ??
																Math.max(
																	0,
																	cacheCreationTokens -
																		(cacheCreation1hTokens ?? 0),
																),
															ephemeral_1h_input_tokens:
																cacheCreation1hTokens ?? 0,
														},
													}),
											},
										}),
									};
									applyExtendedUsageFields(finalStreamUsage, {
										costs: shouldIncludeCosts
											? {
													inputCost: streamingCosts.inputCost,
													outputCost: streamingCosts.outputCost,
													cachedInputCost: streamingCosts.cachedInputCost,
													cacheWriteInputCost:
														streamingCosts.cacheWriteInputCost,
													requestCost: streamingCosts.requestCost,
													webSearchCost: streamingCosts.webSearchCost,
													imageInputCost: streamingCosts.imageInputCost,
													imageOutputCost: streamingCosts.imageOutputCost,
													audioInputCost: streamingCosts.audioInputCost,
													totalCost: streamingCosts.totalCost,
													dataStorageCost: streamingCosts.dataStorageCost,
												}
											: null,
										cachedTokens,
										cacheCreationTokens,
										reasoningTokens,
										audioInputTokens,
									});
									const finalUsageChunk = {
										id: `chatcmpl-${Date.now()}`,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model: usedInternalModel,
										choices: [
											{
												index: 0,
												delta: {},
												finish_reason: null,
											},
										],
										usage: finalStreamUsage,
										metadata: buildFinalResponseMetadata(
											streamingCosts.discount ?? null,
										),
									};

									await writeSSEAndCache({
										data: JSON.stringify(finalUsageChunk),
										id: String(eventId++),
									});
								}

								if (!shouldBufferForHealing) {
									if (splitTaggedReasoning) {
										const flushedRemainder = flushTaggedStreamingRemainder(
											taggedReasoningStreamState,
										);
										if (
											flushedRemainder.content ||
											flushedRemainder.reasoning
										) {
											await writeSSEAndCache({
												data: JSON.stringify({
													id: `chatcmpl-${Date.now()}`,
													object: "chat.completion.chunk",
													created: Math.floor(Date.now() / 1000),
													model: usedInternalModel,
													choices: [
														{
															index: 0,
															delta: {
																...(flushedRemainder.content && {
																	content: flushedRemainder.content,
																}),
																...(flushedRemainder.reasoning && {
																	reasoning: flushedRemainder.reasoning,
																}),
															},
														},
													],
												}),
												id: String(eventId++),
											});
										}
									}

									await writeSSEAndCache({
										event: "done",
										data: "[DONE]",
										id: String(eventId++),
									});
									doneSent = true;
								}

								processedLength = eventEnd;
							} else {
								// Try to parse JSON data - it might span multiple lines
								let data;
								try {
									data = JSON.parse(eventData);
								} catch (e) {
									// If JSON parsing fails, this might be an incomplete event
									// Since we already validated JSON completeness above, this is likely a format issue
									// Create structured error for logging
									streamingError = {
										message: e instanceof Error ? e.message : String(e),
										type: "json_parse_error",
										code: "json_parse_error",
										details: {
											name: e instanceof Error ? e.name : "ParseError",
											eventData: eventData.substring(0, 5000),
											provider: usedProvider,
											model: usedInternalModel,
											eventLength: eventData.length,
											bufferEnd: eventEnd,
											bufferLength: bufferCopy.length,
											timestamp: new Date().toISOString(),
										},
									};
									logger.warn("Failed to parse streaming JSON", {
										error: e instanceof Error ? e.message : String(e),
										eventData:
											eventData.substring(0, 200) +
											(eventData.length > 200 ? "..." : ""),
										provider: usedProvider,
										eventLength: eventData.length,
										bufferEnd: eventEnd,
										bufferLength: bufferCopy.length,
									});

									processedLength = eventEnd;
									searchStart = eventEnd;
									continue;
								}

								const awsBedrockStreamError =
									usedProvider === "aws-bedrock"
										? extractAwsBedrockStreamError(data)
										: null;
								if (
									data &&
									typeof data === "object" &&
									"response" in data &&
									data.response &&
									typeof data.response === "object" &&
									"status" in data.response &&
									data.response.status === "completed"
								) {
									sawOpenAiResponsesCompletedStatus = true;
								}
								if (
									data &&
									typeof data === "object" &&
									"type" in data &&
									typeof data.type === "string" &&
									(data.type === "response.content_part.done" ||
										data.type === "response.output_item.done" ||
										data.type === "response.output_text.done")
								) {
									sawOpenAiResponsesDoneEvent = true;
								}
								const openAiCompatibleStreamError =
									!awsBedrockStreamError &&
									data &&
									typeof data === "object" &&
									"error" in data &&
									data.error &&
									typeof data.error === "object"
										? (data.error as Record<string, unknown>)
										: null;
								if (openAiCompatibleStreamError) {
									const errorResponseText = JSON.stringify(data);
									if (
										debugMode &&
										streamingRawResponseData.length < MAX_RAW_DATA_SIZE
									) {
										const rawProviderSseEvent = `data: ${errorResponseText}\n\n`;
										streamingRawResponseData += rawProviderSseEvent.substring(
											0,
											Math.max(
												0,
												MAX_RAW_DATA_SIZE - streamingRawResponseData.length,
											),
										);
									}
									const inferredStatusCode = inferStreamingErrorStatusCode(
										openAiCompatibleStreamError,
										errorResponseText,
									);
									const errorType = getFinishReasonFromError(
										inferredStatusCode,
										errorResponseText,
									);
									const errorMessage =
										typeof openAiCompatibleStreamError.message === "string"
											? openAiCompatibleStreamError.message
											: "Upstream provider returned a streaming error";
									const errorCode =
										typeof openAiCompatibleStreamError.code === "string"
											? openAiCompatibleStreamError.code
											: typeof openAiCompatibleStreamError.type === "string"
												? openAiCompatibleStreamError.type
												: errorType;

									logger.info("[streaming] Provider SSE error received", {
										requestId,
										provider: usedProvider,
										model: usedInternalModel,
										errorType,
										errorCode,
										inferredStatusCode,
										errorMessage,
										errorPayload: errorResponseText.substring(0, 5000),
									});

									finishReason = errorType;

									if (errorType === "content_filter") {
										await writeStreamingContentFilterResponse({
											billingModel: usedInternalModel,
											billingProvider: usedProvider,
											billingRegion: usedRegion ?? null,
											responseModel: data.model ?? usedInternalModel,
										});
										handledTerminalProviderEvent = true;
									} else {
										streamingError = {
											message: errorMessage,
											type: errorType,
											code: errorCode,
											details: {
												statusCode: inferredStatusCode,
												statusText:
													typeof openAiCompatibleStreamError.type === "string"
														? openAiCompatibleStreamError.type
														: "stream_error",
												responseText: errorResponseText,
											},
										};

										await writeSSEAndCache({
											event: "error",
											data: JSON.stringify({
												error: {
													message: errorMessage,
													type: errorType,
													code: errorCode,
													param:
														"param" in openAiCompatibleStreamError
															? (openAiCompatibleStreamError.param ?? null)
															: null,
													responseText: errorResponseText,
												},
											}),
											id: String(eventId++),
										});
									}

									if (!doneSent) {
										await writeSSEAndCache({
											event: "done",
											data: "[DONE]",
											id: String(eventId++),
										});
										doneSent = true;
									}
									shouldTerminateStream = true;
									processedLength = eventEnd;
									searchStart = eventEnd;
									break;
								}
								if (awsBedrockStreamError) {
									const errorType = getFinishReasonFromError(
										awsBedrockStreamError.statusCode,
										awsBedrockStreamError.responseText,
									);

									streamingError = {
										message: awsBedrockStreamError.message,
										type: errorType,
										code: awsBedrockStreamError.eventType,
										details: {
											statusCode: awsBedrockStreamError.statusCode,
											statusText: awsBedrockStreamError.eventType,
											responseText: awsBedrockStreamError.responseText,
										},
									};
									finishReason = errorType;

									await writeSSEAndCache({
										event: "error",
										data: JSON.stringify({
											error: {
												message: awsBedrockStreamError.message,
												type: errorType,
												code: awsBedrockStreamError.eventType,
												param: null,
												responseText: awsBedrockStreamError.responseText,
											},
										}),
										id: String(eventId++),
									});
									await writeSSEAndCache({
										event: "done",
										data: "[DONE]",
										id: String(eventId++),
									});
									doneSent = true;
									shouldTerminateStream = true;
									processedLength = eventEnd;
									searchStart = eventEnd;
									break;
								}

								// Transform streaming responses to OpenAI format for all providers
								const transformedData = transformStreamingToOpenai(
									usedProvider,
									usedInternalModel,
									data,
									messages,
									serverToolUseIndices,
									supportsReasoning,
								);

								// Skip null events (some providers have non-data events)
								if (!transformedData) {
									processedLength = eventEnd;
									searchStart = eventEnd;
									continue;
								}

								// A chunk whose finish_reason signals an upstream failure (e.g.
								// Embercloud's "error") is not a valid OpenAI completion chunk —
								// "error" is not a valid OpenAI finish_reason. Capture the
								// terminal finish reason and raw payload for the error event and
								// logging, but skip this chunk entirely otherwise: it is not
								// forwarded to the client and must not feed content/token/cost
								// accumulation, since the client never receives it.
								const isUpstreamErrorChunk =
									transformedData.choices?.some(
										(choice: { finish_reason?: string | null }) =>
											choice?.finish_reason === "error",
									) ?? false;
								if (isUpstreamErrorChunk) {
									finishReason = "error";
									sawProviderTerminalEvent = true;
									upstreamErrorChunkRaw = JSON.stringify(data);
									processedLength = eventEnd;
									searchStart = eventEnd;
									continue;
								}

								if (splitTaggedReasoning) {
									const deltaContent =
										transformedData.choices?.[0]?.delta?.content;

									if (
										typeof deltaContent === "string" &&
										deltaContent.length > 0
									) {
										const splitChunk = splitTaggedStreamingContentChunk(
											deltaContent,
											taggedReasoningStreamState,
										);

										if (splitChunk.content) {
											transformedData.choices[0].delta.content =
												splitChunk.content;
										} else {
											delete transformedData.choices[0].delta.content;
										}

										if (splitChunk.reasoning) {
											transformedData.choices[0].delta.reasoning =
												(transformedData.choices[0].delta.reasoning ?? "") +
												splitChunk.reasoning;
										}
									}
								}

								// For Anthropic, if we have partial usage data, complete it
								if (
									(usedProvider === "anthropic" ||
										usedProvider === "vertex-anthropic") &&
									transformedData.usage
								) {
									const usage = transformedData.usage;
									if (
										usage.output_tokens !== undefined &&
										usage.prompt_tokens === undefined
									) {
										// Estimate prompt tokens if not provided
										const estimation = estimateTokens(
											usedProvider,
											messages,
											null,
											null,
											null,
										);
										const estimatedPromptTokens =
											estimation.calculatedPromptTokens;
										transformedData.usage = {
											prompt_tokens: estimatedPromptTokens,
											completion_tokens: usage.output_tokens,
											total_tokens: estimatedPromptTokens + usage.output_tokens,
										};
									}
								}

								if (usedProvider === "openai") {
									const served = resolveOpenAIServiceTier(data);
									if (served !== undefined) {
										servedServiceTier = served;
									}
								}

								// For Google providers, add usage information when available
								if (isGoogleCompatibleProvider(usedProvider)) {
									const usage = extractTokenUsage(
										data,
										usedProvider,
										fullContent,
										imageByteSize,
									);

									logVertexTrafficType(
										usedProvider,
										getForwardedServiceTier(
											usedInternalModel,
											usedProvider,
											usedRegion,
											service_tier,
											configIndex,
										),
										data,
									);
									{
										const served = resolveServedServiceTier({
											trafficType: data?.usageMetadata?.trafficType,
										});
										if (served) {
											servedServiceTier = served;
										}
									}

									// If we have usage data from Google, add it to the streaming chunk
									if (
										usage.promptTokens !== null ||
										usage.completionTokens !== null ||
										usage.totalTokens !== null
									) {
										transformedData.usage = {
											prompt_tokens: usage.promptTokens ?? 0,
											completion_tokens: usage.completionTokens ?? 0,
											total_tokens: usage.totalTokens ?? 0,
											...(usage.reasoningTokens !== null && {
												reasoning_tokens: usage.reasoningTokens,
											}),
										};
									}
								}

								// Normalize usage.prompt_tokens_details to always include cached_tokens
								if (transformedData.usage) {
									if (transformedData.usage.prompt_tokens_details) {
										// Preserve all existing keys and only default cached_tokens
										transformedData.usage.prompt_tokens_details = {
											...transformedData.usage.prompt_tokens_details,
											cached_tokens:
												transformedData.usage.prompt_tokens_details
													.cached_tokens ?? 0,
										};
									} else {
										// Create prompt_tokens_details with cached_tokens set to 0
										transformedData.usage.prompt_tokens_details = {
											cached_tokens: 0,
										};
									}
								}

								// For Anthropic streaming tool calls, enrich delta chunks with id/type/name
								// from the initial content_block_start event. This ensures OpenAI SDK compatibility.
								if (
									usedProvider === "anthropic" ||
									usedProvider === "vertex-anthropic"
								) {
									const toolCalls =
										transformedData.choices?.[0]?.delta?.tool_calls;
									if (toolCalls && toolCalls.length > 0) {
										// First, extract tool calls to update our tracking
										const rawToolCalls = extractToolCalls(data, usedProvider);
										if (rawToolCalls && rawToolCalls.length > 0) {
											streamingToolCalls ??= [];
											for (const newCall of rawToolCalls) {
												// For content_block_start events (have id), add to tracking
												if (newCall.id) {
													const contentBlockIndex: number =
														typeof data.index === "number"
															? data.index
															: streamingToolCalls.length;
													// Store at the content block index position
													streamingToolCalls[contentBlockIndex] = {
														...newCall,
														_contentBlockIndex: contentBlockIndex,
													};
												}
												// For content_block_delta events, enrich with stored id/type/name
												else if (newCall._contentBlockIndex !== undefined) {
													const existingCall =
														streamingToolCalls[newCall._contentBlockIndex];
													if (existingCall) {
														// Enrich the transformed data with id, type, and function.name
														for (const tc of toolCalls) {
															if (tc.index === newCall._contentBlockIndex) {
																tc.id = existingCall.id;
																tc.type = "function";
																tc.function ??= {};
																tc.function.name = existingCall.function.name;
															}
														}
													}
												}
											}
										}
									}
								}

								// When buffering for healing, strip content from chunks and buffer it
								// We still send metadata (usage, finish_reason, tool_calls) but buffer text content
								if (shouldBufferForHealing) {
									const deltaContent =
										transformedData.choices?.[0]?.delta?.content;
									if (deltaContent) {
										bufferedContentChunks.push(deltaContent);
										// Store chunk metadata for later use when sending healed content
										lastChunkId = transformedData.id ?? lastChunkId;
										lastChunkModel = transformedData.model ?? lastChunkModel;
										lastChunkCreated =
											transformedData.created ?? lastChunkCreated;
									}

									// Create a copy without content in delta for streaming
									const chunkWithoutContent = JSON.parse(
										JSON.stringify(transformedData),
									);
									if (chunkWithoutContent.choices?.[0]?.delta?.content) {
										delete chunkWithoutContent.choices[0].delta.content;
									}

									// Only send chunk if it has meaningful data (not just empty delta)
									const hasUsage = !!chunkWithoutContent.usage;
									const hasToolCalls =
										!!chunkWithoutContent.choices?.[0]?.delta?.tool_calls;
									const hasFinishReason =
										!!chunkWithoutContent.choices?.[0]?.finish_reason;
									const hasRole =
										!!chunkWithoutContent.choices?.[0]?.delta?.role;

									if (hasUsage || hasToolCalls || hasFinishReason || hasRole) {
										await writeSSEAndCache({
											data: JSON.stringify(chunkWithoutContent),
											id: String(eventId++),
										});
									}
								} else {
									await writeSSEAndCache({
										data: JSON.stringify(transformedData),
										id: String(eventId++),
									});
								}

								// Extract usage data from transformedData to update tracking variables
								if (
									transformedData.usage &&
									(usedProvider === "openai" || usedProvider === "azure")
								) {
									const usage = transformedData.usage;
									if (
										usage.prompt_tokens !== undefined &&
										usage.prompt_tokens > 0
									) {
										promptTokens = usage.prompt_tokens;
									}
									if (
										usage.completion_tokens !== undefined &&
										usage.completion_tokens > 0
									) {
										completionTokens = usage.completion_tokens;
									}
									if (
										usage.total_tokens !== undefined &&
										usage.total_tokens > 0
									) {
										totalTokens = usage.total_tokens;
									}
									if (usage.reasoning_tokens !== undefined) {
										reasoningTokens = usage.reasoning_tokens;
									}
								}

								// Extract finishReason from transformedData. Iterate every
								// choice so that n > 1 streams update tracking from whichever
								// choice has terminated, not just index 0.
								if (Array.isArray(transformedData.choices)) {
									for (const choice of transformedData.choices) {
										if (choice?.finish_reason) {
											// Anthropic/Vertex-Anthropic finish reasons are owned by
											// the provider-specific switch below, which reads the raw
											// stop_reason (e.g. "refusal") from message_delta. Don't
											// let the transformed message_stop chunk (mapped to
											// "stop") clobber a refusal captured moments earlier.
											if (
												usedProvider !== "anthropic" &&
												usedProvider !== "vertex-anthropic"
											) {
												finishReason = choice.finish_reason;
											}
											sawProviderTerminalEvent = true;
											sentDownstreamFinishReasonChunk = true;
										}
									}
								}

								// Extract content for logging using helper function
								// For providers with custom extraction logic (google-ai-studio, anthropic),
								// use raw data. For others (like aws-bedrock), use transformed OpenAI format.
								const contentChunk = extractContent(
									isGoogleCompatibleProvider(usedProvider) ||
										usedProvider === "anthropic" ||
										usedProvider === "vertex-anthropic"
										? data
										: transformedData,
									usedProvider,
								);
								if (contentChunk) {
									fullContent += contentChunk;

									// Track time to first token if this is the first content chunk
									if (!firstTokenReceived) {
										timeToFirstToken = Date.now() - startTime;
										firstTokenReceived = true;
									}
								}

								// Track image data size for Google providers (for token estimation)
								if (isGoogleCompatibleProvider(usedProvider)) {
									const parts = data.candidates?.[0]?.content?.parts ?? [];
									for (const part of parts) {
										if (part.inlineData?.data) {
											// Base64 string length * 0.75 ≈ actual byte size
											imageByteSize += Math.ceil(
												part.inlineData.data.length * 0.75,
											);
											outputImageCount++;
										}
									}
								}

								// Track web search calls for cost calculation
								// Check for web search results based on provider-specific data
								if (
									usedProvider === "anthropic" ||
									usedProvider === "vertex-anthropic"
								) {
									// For Anthropic, count web_search_tool_result blocks
									if (
										data.type === "content_block_start" &&
										data.content_block?.type === "web_search_tool_result"
									) {
										webSearchCount++;
									}
								} else if (isGoogleCompatibleProvider(usedProvider)) {
									// For Google, count when grounding metadata is present
									if (data.candidates?.[0]?.groundingMetadata) {
										const groundingMetadata =
											data.candidates[0].groundingMetadata;
										if (
											groundingMetadata.webSearchQueries &&
											groundingMetadata.webSearchQueries.length > 0 &&
											webSearchCount === 0
										) {
											// Only count once for the entire response
											webSearchCount =
												groundingMetadata.webSearchQueries.length;
										} else if (
											groundingMetadata.groundingChunks &&
											webSearchCount === 0
										) {
											// Fallback: count once if we have grounding chunks
											webSearchCount = 1;
										}
									}
								} else if (usedProvider === "openai") {
									// For OpenAI Responses API, count web_search_call.completed events
									if (data.type === "response.web_search_call.completed") {
										webSearchCount++;
									}
								}

								// Extract reasoning content for logging using helper function
								// For providers with custom extraction logic (google-ai-studio, anthropic),
								// use raw data. For others, use transformed OpenAI format.
								const reasoningContentChunk = extractReasoning(
									isGoogleCompatibleProvider(usedProvider) ||
										usedProvider === "anthropic" ||
										usedProvider === "vertex-anthropic"
										? data
										: transformedData,
									usedProvider,
								);
								if (reasoningContentChunk) {
									fullReasoningContent += reasoningContentChunk;

									// Track time to first reasoning token if this is the first reasoning chunk
									if (!firstReasoningTokenReceived) {
										timeToFirstReasoningToken = Date.now() - startTime;
										firstReasoningTokenReceived = true;
									}
								}

								const toolCallsChunk = extractToolCalls(
									data,
									usedProvider,
									transformedData,
								);
								if (toolCallsChunk && toolCallsChunk.length > 0) {
									streamingToolCalls ??= [];
									// Merge tool calls (accumulating function arguments)
									for (const newCall of toolCallsChunk) {
										let existingCall = null;

										// For Anthropic content_block_delta events, match by content block index
										if (
											(usedProvider === "anthropic" ||
												usedProvider === "vertex-anthropic") &&
											newCall._contentBlockIndex !== undefined
										) {
											existingCall =
												streamingToolCalls[newCall._contentBlockIndex];
										} else {
											// For other providers and Anthropic content_block_start, match by ID
											// Note: Array may have sparse entries due to index-based assignment, so check for null/undefined
											existingCall = streamingToolCalls.find(
												(call) => call && call.id === newCall.id,
											);
										}

										if (existingCall) {
											// Accumulate function arguments
											if (newCall.function?.arguments) {
												existingCall.function.arguments =
													(existingCall.function.arguments ?? "") +
													newCall.function.arguments;
											}
										} else {
											// Clean up temporary fields and add new tool call
											const cleanCall = { ...newCall };
											delete cleanCall._contentBlockIndex;
											streamingToolCalls.push(cleanCall);
										}
									}
								}

								// Handle provider-specific finish reason extraction
								switch (usedProvider) {
									case "google-ai-studio":
									case "glacier":
									case "google-vertex":
									case "quartz":
										// Preserve original Google finish reason for logging
										if (data.promptFeedback?.blockReason) {
											finishReason = data.promptFeedback.blockReason;
											sawProviderTerminalEvent = true;
										} else if (data.candidates?.[0]?.finishReason) {
											finishReason = data.candidates[0].finishReason;
											sawProviderTerminalEvent = true;
										}
										break;
									case "anthropic":
									case "vertex-anthropic":
										if (
											data.type === "message_delta" &&
											data.delta?.stop_reason
										) {
											finishReason = data.delta.stop_reason;
											sawProviderTerminalEvent = true;
										} else if (
											data.type === "message_stop" ||
											data.stop_reason
										) {
											// message_stop carries no stop_reason of its own — the
											// real terminal reason arrived in the preceding
											// message_delta. Only fall back to end_turn when we never
											// captured one, so we don't clobber e.g. a "refusal".
											finishReason =
												data.stop_reason ?? finishReason ?? "end_turn";
											sawProviderTerminalEvent = true;
										} else if (data.delta?.stop_reason) {
											finishReason = data.delta.stop_reason;
											sawProviderTerminalEvent = true;
										}
										break;
									case "aws-bedrock":
										// The client-facing finish_reason comes from the
										// transformed chunk (a refusal is surfaced as
										// content_filter). Internally, preserve the raw
										// "refusal" stop reason from the messageStop event so
										// billing can skip charging an unbilled refusal.
										if (
											data.__aws_event_type === "messageStop" &&
											data.stopReason === "refusal"
										) {
											finishReason = "refusal";
											sawProviderTerminalEvent = true;
										}
										break;
									default: // OpenAI format
										// Iterate every choice so n > 1 streams capture the
										// terminal reason from whichever index ended last.
										if (Array.isArray(data.choices)) {
											for (const choice of data.choices) {
												if (choice?.finish_reason) {
													finishReason = choice.finish_reason;
												}
											}
										}
										break;
								}

								// Extract token usage using helper function
								const usage = extractTokenUsage(
									data,
									usedProvider,
									fullContent,
									imageByteSize,
								);
								if (usage.promptTokens !== null) {
									promptTokens = usage.promptTokens;
								}
								if (usage.completionTokens !== null) {
									completionTokens = usage.completionTokens;
								}
								if (usage.totalTokens !== null) {
									totalTokens = usage.totalTokens;
								}
								if (usage.reasoningTokens !== null) {
									reasoningTokens = usage.reasoningTokens;
								}
								if (usage.cachedTokens !== null) {
									cachedTokens = usage.cachedTokens;
								}
								if (usage.cacheCreationTokens !== null) {
									cacheCreationTokens = usage.cacheCreationTokens;
								}
								if (usage.cacheCreation5mTokens !== null) {
									cacheCreation5mTokens = usage.cacheCreation5mTokens;
								}
								if (usage.cacheCreation1hTokens !== null) {
									cacheCreation1hTokens = usage.cacheCreation1hTokens;
								}
								if (usage.audioInputTokens !== null) {
									audioInputTokens = usage.audioInputTokens;
								}
								if (usage.cachedAudioInputTokens !== null) {
									cachedAudioInputTokens = usage.cachedAudioInputTokens;
								}
								if (
									usage.totalTokens === null &&
									promptTokens !== null &&
									completionTokens !== null
								) {
									totalTokens = promptTokens + completionTokens;
								}

								// Estimate tokens if not provided and we have a finish reason
								if (finishReason && (!promptTokens || !completionTokens)) {
									if (!promptTokens) {
										const estimation = estimateTokens(
											usedProvider,
											messages,
											null,
											null,
											null,
										);
										promptTokens = estimation.calculatedPromptTokens;
									}

									if (!completionTokens) {
										const textTokens = estimateTokensFromContent(fullContent);
										// For images, estimate ~258 tokens per image + 1 token per 750 bytes
										let imageTokens = 0;
										if (imageByteSize > 0) {
											imageTokens = 258 + Math.ceil(imageByteSize / 750);
										}
										completionTokens = textTokens + imageTokens;
									}

									totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
								}

								processedLength = eventEnd;
							}

							searchStart = eventEnd;
						}

						// Remove processed data from buffer
						if (processedLength > 0) {
							buffer = bufferCopy.slice(processedLength);
						}

						if (shouldTerminateStream) {
							break;
						}
					}
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError") {
						canceled = true;
					} else if (isTimeoutError(error)) {
						const errorMessage =
							error instanceof Error ? error.message : "Stream reading timeout";
						logger.warn("Stream reading timeout", {
							error: errorMessage,
							usedProvider,
							requestedProvider,
							usedInternalModel,
							initialRequestedModel,
							unifiedFinishReason: getUnifiedFinishReason(
								"upstream_error",
								usedProvider,
							),
						});

						try {
							await stream.writeSSE({
								event: "error",
								data: JSON.stringify({
									error: {
										message: `Upstream provider timeout: ${errorMessage}`,
										type: "upstream_timeout",
										param: null,
										code: "timeout",
									},
								}),
								id: String(eventId++),
							});
							await stream.writeSSE({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
							doneSent = true;
						} catch (sseError) {
							logger.error(
								"Failed to send timeout error SSE",
								sseError instanceof Error
									? sseError
									: new Error(String(sseError)),
							);
						}

						streamingError = {
							message: errorMessage,
							type: "upstream_timeout",
							code: "timeout",
							details: {
								name: "TimeoutError",
								timestamp: new Date().toISOString(),
								provider: usedProvider,
								model: usedInternalModel,
							},
						};
					} else {
						const normalizedStreamingError = normalizeStreamingError({
							error,
							provider: usedProvider,
							model: usedInternalModel,
							bufferSnapshot: buffer ? buffer.substring(0, 5000) : undefined,
							phase: "upstream_read",
						});

						logger.error("Error reading upstream stream", toError(error), {
							requestId,
							usedProvider,
							requestedProvider,
							usedInternalModel,
							initialRequestedModel,
							upstreamStatus: res?.status ?? null,
							upstreamStatusText: res?.statusText ?? null,
							upstreamHeaders: res
								? {
										contentType: res.headers.get("content-type"),
										contentLength: res.headers.get("content-length"),
										transferEncoding: res.headers.get("transfer-encoding"),
										requestId:
											res.headers.get("x-request-id") ??
											res.headers.get("request-id") ??
											res.headers.get("openai-request-id"),
									}
								: null,
							streamingDiagnostics: normalizedStreamingError.log.details,
							timeToFirstToken,
							timeToFirstReasoningToken,
							firstTokenReceived,
							firstReasoningTokenReceived,
							unifiedFinishReason: getUnifiedFinishReason(
								normalizedStreamingError.client.type === "gateway_error"
									? "gateway_error"
									: "upstream_error",
								usedProvider,
							),
						});

						// Forward the error to the client with the buffered content that caused the error
						try {
							await stream.writeSSE({
								event: "error",
								data: JSON.stringify({
									error: normalizedStreamingError.client,
								}),
								id: String(eventId++),
							});
							await stream.writeSSE({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
							doneSent = true;
						} catch (sseError) {
							logger.error(
								"Failed to send error SSE",
								sseError instanceof Error
									? sseError
									: new Error(String(sseError)),
							);
						}

						streamingError = normalizedStreamingError.log;
					}
				} finally {
					// Clean up the reader to prevent file descriptor leaks
					try {
						await reader.cancel();
					} catch {
						// Ignore errors from cancel - the stream may already be aborted due to timeout
					}
					// Clean up the event listeners
					c.req.raw.signal.removeEventListener("abort", onAbort);

					// Log the streaming request
					const duration = Date.now() - startTime;

					// Calculate estimated tokens if not provided
					let calculatedPromptTokens = promptTokens;
					let calculatedCompletionTokens = completionTokens;
					let calculatedTotalTokens = totalTokens;

					// Estimate tokens for providers that don't provide them during streaming
					if (!promptTokens || !completionTokens) {
						if (!promptTokens && messages && messages.length > 0) {
							calculatedPromptTokens = encodeChatMessages(messages);
						}

						if (!completionTokens && (fullContent || imageByteSize > 0)) {
							// For images, estimate ~258 tokens per image + 1 token per 750 bytes
							let imageTokens = 0;
							if (imageByteSize > 0) {
								imageTokens = 258 + Math.ceil(imageByteSize / 750);
							}

							const textTokens = estimateTokensFromContent(fullContent);
							calculatedCompletionTokens = textTokens + imageTokens;
						}

						calculatedTotalTokens =
							(calculatedPromptTokens ?? 0) + (calculatedCompletionTokens ?? 0);
					}

					// Estimate reasoning tokens if not provided but reasoning content exists
					let calculatedReasoningTokens = reasoningTokens;
					if (!reasoningTokens && fullReasoningContent) {
						calculatedReasoningTokens =
							estimateTokensFromContent(fullReasoningContent);
					}

					if (
						!streamingError &&
						!canceled &&
						finishReason === null &&
						sawOpenAiResponsesDoneEvent &&
						sawOpenAiResponsesCompletedStatus
					) {
						sawProviderTerminalEvent = true;
						finishReason =
							streamingToolCalls && streamingToolCalls.length > 0
								? "tool_calls"
								: "stop";
					}

					const streamHasVerifiedTerminalEvent =
						sawUpstreamDoneSentinel ||
						sawProviderTerminalEvent ||
						handledTerminalProviderEvent;
					// A terminal finish reason (stop, tool_calls, length) also counts
					// as a valid stream completion — some providers (e.g. MiniMax)
					// send finish_reason but omit the [DONE] sentinel.
					const hasTerminalFinishReason =
						finishReason !== null &&
						finishReason !== "upstream_error" &&
						finishReason !== "gateway_error";
					const streamEndedWithoutTerminalEvent =
						!streamingError &&
						!canceled &&
						!streamHasVerifiedTerminalEvent &&
						!hasTerminalFinishReason;
					if (streamEndedWithoutTerminalEvent) {
						const hasBufferedNonWhitespace = /\S/u.test(buffer);
						const responseText = hasBufferedNonWhitespace
							? buffer.slice(0, 5000)
							: "Stream ended before a terminal finish reason or [DONE] event";
						const errorMessage =
							"Upstream stream terminated unexpectedly before completion";

						logger.warn("[streaming] Stream ended without terminal event", {
							provider: usedProvider,
							model: usedInternalModel,
							bufferLength: buffer.length,
							fullContentLength: fullContent.length,
							hasToolCalls:
								!!streamingToolCalls && streamingToolCalls.length > 0,
							unifiedFinishReason: getUnifiedFinishReason(
								"upstream_error",
								usedProvider,
							),
						});

						streamingError = {
							message: errorMessage,
							type: "upstream_error",
							code: "stream_truncated",
							details: {
								statusCode: 502,
								statusText: "Upstream Stream Terminated",
								responseText,
								timestamp: new Date().toISOString(),
								provider: usedProvider,
								model: usedInternalModel,
								bufferLength: buffer.length,
							},
						};
						finishReason = "upstream_error";

						try {
							await writeSSEAndCache({
								event: "error",
								data: JSON.stringify({
									error: {
										message: errorMessage,
										type: "upstream_error",
										code: "stream_truncated",
										param: null,
										responseText,
									},
								}),
								id: String(eventId++),
							});
							await writeSSEAndCache({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
							doneSent = true;
						} catch (sseError) {
							logger.error(
								"Failed to send truncated stream error SSE",
								sseError instanceof Error
									? sseError
									: new Error(String(sseError)),
							);
						}
					}

					// A finish_reason that itself signals an upstream failure (e.g.
					// Embercloud emits finish_reason "error" with a null content delta and
					// no error event/HTTP error) is a hard error in its own right. Treat it
					// as an upstream error regardless of whether any partial content
					// arrived, instead of inferring failure from an empty response.
					const hasUpstreamErrorFinishReason =
						!streamingError && finishReason === "error";

					// Check if the response finished successfully but has no content, tokens, or tool calls
					// This indicates an empty response which should be marked as an error
					// Do this check BEFORE sending usage chunks to ensure proper event ordering
					// Exclude content filter responses as they are intentionally empty.
					const isContentFilterStreamingResponse = isContentFilterFinishReason(
						finishReason,
						usedProvider,
					);
					const hasEmptyResponse =
						!streamingError &&
						!hasUpstreamErrorFinishReason &&
						finishReason &&
						finishReason !== "incomplete" &&
						!isContentFilterStreamingResponse &&
						(!calculatedCompletionTokens || calculatedCompletionTokens === 0) &&
						(!calculatedReasoningTokens || calculatedReasoningTokens === 0) &&
						(!fullContent || fullContent.trim() === "") &&
						(!streamingToolCalls || streamingToolCalls.length === 0);

					let streamingCostsEarly:
						| Awaited<ReturnType<typeof calculateCosts>>
						| undefined;

					if (hasUpstreamErrorFinishReason || hasEmptyResponse) {
						const errorMessage = hasUpstreamErrorFinishReason
							? `Upstream provider terminated the stream with finish_reason "${finishReason}"`
							: "Response finished successfully but returned no content or tool calls";
						logger.warn(
							hasUpstreamErrorFinishReason
								? "[streaming] Upstream error finish_reason"
								: "[streaming] Empty response detected",
							{
								provider: usedProvider,
								model: usedInternalModel,
								finishReason,
								calculatedCompletionTokens,
								calculatedReasoningTokens,
								fullContentLength: fullContent?.length ?? 0,
								fullContentTrimmed: fullContent?.trim()?.length ?? 0,
								streamingToolCallsCount: streamingToolCalls?.length ?? 0,
								promptTokens,
								completionTokens,
								totalTokens,
								reasoningTokens,
								unifiedFinishReason: getUnifiedFinishReason(
									"upstream_error",
									usedProvider,
								),
							},
						);
						// For an explicit upstream error finish_reason, preserve the raw
						// provider chunk as responseText so the log reflects what the
						// upstream actually sent, not just our synthesized message.
						streamingError = hasUpstreamErrorFinishReason
							? {
									message: errorMessage,
									type: "upstream_error",
									code: "upstream_finish_reason_error",
									details: {
										statusCode: 502,
										statusText: "Upstream Stream Error",
										responseText: upstreamErrorChunkRaw ?? errorMessage,
										timestamp: new Date().toISOString(),
										provider: usedProvider,
										model: usedInternalModel,
									},
								}
							: errorMessage;
						finishReason = "upstream_error";

						// Send error event to client using writeSSEAndCache to cache the error
						try {
							await writeSSEAndCache({
								event: "error",
								data: JSON.stringify({
									error: {
										message: errorMessage,
										type: "upstream_error",
										code: "upstream_error",
										param: null,
										responseText: errorMessage,
									},
								}),
								id: String(eventId++),
							});
							await writeSSEAndCache({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});
							doneSent = true;
						} catch (sseError) {
							logger.error(
								"Failed to send upstream error SSE",
								sseError instanceof Error
									? sseError
									: new Error(String(sseError)),
							);
						}
					} else if (!streamingError && !doneSent) {
						if (
							finishReason &&
							!sentDownstreamFinishReasonChunk &&
							!shouldBufferForHealing
						) {
							try {
								const finishChunk = {
									id: `chatcmpl-${Date.now()}`,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: usedInternalModel,
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: mapFinishReasonToOpenai(
												finishReason,
												usedProvider,
												!!streamingToolCalls && streamingToolCalls.length > 0,
											),
										},
									],
								};

								await writeSSEAndCache({
									data: JSON.stringify(finishChunk),
									id: String(eventId++),
								});
								sentDownstreamFinishReasonChunk = true;
							} catch (error) {
								logger.error(
									"Error sending synthesized finish chunk",
									toError(error),
								);
							}
						}

						// Calculate costs before sending usage chunk so we can include cost data
						const billCancelledRequestsEarly = shouldBillCancelledRequests();
						streamingCostsEarly =
							canceled && !billCancelledRequestsEarly
								? {
										inputCost: null,
										outputCost: null,
										cachedInputCost: null,
										cacheWriteInputCost: null,
										requestCost: null,
										webSearchCost: null,
										contentFilterCost: null,
										imageInputTokens: null,
										imageOutputTokens: null,
										imageInputCost: null,
										imageOutputCost: null,
										audioInputTokens: null,
										audioInputCost: null,
										totalCost: null,
										promptTokens: null,
										completionTokens: null,
										cachedTokens: null,
										cacheWriteTokens: null,
										estimatedCost: false,
										discount: undefined,
										pricingTier: undefined,
										dataStorageCost: null as number | null,
									}
								: await calculateCosts(
										usedInternalModel,
										usedProvider,
										usedRegion ?? null,
										calculatedPromptTokens,
										calculatedCompletionTokens,
										cachedTokens,
										{
											prompt: messages
												.map((m) => messageContentToString(m.content))
												.join("\n"),
											completion: fullContent,
											toolResults: streamingToolCalls ?? undefined,
										},
										reasoningTokens,
										outputImageCount,
										image_config?.image_size,
										inputImageCount,
										webSearchCount,
										project.organizationId,
										image_config?.image_quality,
										null,
										null,
										{
											cacheWriteTokens: cacheCreationTokens,
											cacheWrite1hTokens: cacheCreation1hTokens,
											audioInputTokens,
											cachedAudioInputTokens,
											explicitCacheUsed,
											servedServiceTier,
										},
										finishReason === "content_filter",
									);
						if (streamingCostsEarly.totalCost !== null) {
							streamingCostsEarly.dataStorageCost = toDataStorageCostNumber(
								streamingCostsEarly.promptTokens ?? calculatedPromptTokens,
								cachedTokens,
								streamingCostsEarly.completionTokens ??
									calculatedCompletionTokens,
								reasoningTokens,
								retentionLevel,
							);
						}

						// Anthropic-family refusal that produced no output is not billed
						// (per Anthropic's policy: a refusal before any generated output
						// is informational only). A mid-stream refusal that already
						// produced content is billed normally.
						if (
							streamingCostsEarly.totalCost !== null &&
							isRefusalFinishReason(finishReason, usedProvider) &&
							!hasMeaningfulAssistantOutput({
								completionTokens: calculatedCompletionTokens,
								reasoningTokens,
								content: fullContent,
								toolResults: streamingToolCalls,
								images: null,
							})
						) {
							zeroInferenceCosts(streamingCostsEarly);
						}

						// Always send final usage chunk with cost data for SDK compatibility
						try {
							const finalUsageChunk = {
								id: `chatcmpl-${Date.now()}`,
								object: "chat.completion.chunk",
								created: Math.floor(Date.now() / 1000),
								model: usedInternalModel,
								choices: [
									{
										index: 0,
										delta: {},
										finish_reason: null,
									},
								],
								usage: (() => {
									// Only add image input tokens for providers that
									// exclude them from upstream usage (Google)
									const providerExcludesImageInput =
										isGoogleCompatibleProvider(usedProvider);
									const imageInputAdj = providerExcludesImageInput
										? inputImageCount * 560
										: 0;
									const adjPrompt = Math.max(
										1,
										Math.round(
											promptTokens && promptTokens > 0
												? promptTokens + imageInputAdj
												: (calculatedPromptTokens ?? 1) + imageInputAdj,
										),
									);
									const adjCompletion = Math.round(
										completionTokens ?? calculatedCompletionTokens ?? 0,
									);
									const earlyUsage: Record<string, any> = {
										prompt_tokens: adjPrompt,
										completion_tokens: adjCompletion,
										total_tokens: Math.max(
											1,
											Math.round(adjPrompt + adjCompletion),
										),
										...(reasoningTokens !== null &&
											reasoningTokens > 0 && {
												reasoning_tokens: reasoningTokens,
											}),
										...((cachedTokens !== null ||
											(cacheCreationTokens !== null &&
												cacheCreationTokens > 0)) && {
											prompt_tokens_details: {
												cached_tokens: cachedTokens ?? 0,
												...(cacheCreationTokens !== null &&
													cacheCreationTokens > 0 && {
														cache_creation_tokens: cacheCreationTokens,
													}),
												...(cacheCreationTokens !== null &&
													cacheCreationTokens > 0 &&
													(cacheCreation5mTokens !== null ||
														cacheCreation1hTokens !== null) && {
														cache_creation: {
															ephemeral_5m_input_tokens:
																cacheCreation5mTokens ??
																Math.max(
																	0,
																	cacheCreationTokens -
																		(cacheCreation1hTokens ?? 0),
																),
															ephemeral_1h_input_tokens:
																cacheCreation1hTokens ?? 0,
														},
													}),
											},
										}),
									};
									applyExtendedUsageFields(earlyUsage, {
										costs: {
											inputCost: streamingCostsEarly.inputCost,
											outputCost: streamingCostsEarly.outputCost,
											cachedInputCost: streamingCostsEarly.cachedInputCost,
											cacheWriteInputCost:
												streamingCostsEarly.cacheWriteInputCost,
											requestCost: streamingCostsEarly.requestCost,
											webSearchCost: streamingCostsEarly.webSearchCost,
											contentFilterCost: streamingCostsEarly.contentFilterCost,
											imageInputCost: streamingCostsEarly.imageInputCost,
											imageOutputCost: streamingCostsEarly.imageOutputCost,
											audioInputCost: streamingCostsEarly.audioInputCost,
											totalCost: streamingCostsEarly.totalCost,
											dataStorageCost: streamingCostsEarly.dataStorageCost,
										},
										cachedTokens,
										cacheCreationTokens,
										reasoningTokens,
										audioInputTokens,
									});
									return earlyUsage;
								})(),
								metadata: buildFinalResponseMetadata(
									streamingCostsEarly.discount ?? null,
								),
							};

							await writeSSEAndCache({
								data: JSON.stringify(finalUsageChunk),
								id: String(eventId++),
							});
						} catch (error) {
							logger.error("Error sending final usage chunk", toError(error));
						}

						// Send healed content if buffering was enabled
						if (
							shouldBufferForHealing &&
							bufferedContentChunks.length > 0 &&
							!streamingError
						) {
							try {
								// Combine buffered content and apply healing
								const bufferedContent = bufferedContentChunks.join("");
								const healingResult = healJsonResponse(bufferedContent);

								// Store plugin results for logging
								streamingPluginResults.responseHealing = {
									healed: healingResult.healed,
									healingMethod: healingResult.healingMethod,
								};

								if (healingResult.healed) {
									logger.debug("Streaming response healing applied", {
										method: healingResult.healingMethod,
										originalLength: healingResult.originalContent.length,
										healedLength: healingResult.content.length,
									});
									// Update fullContent with healed version for logging
									fullContent = healingResult.content;
								}

								// Send the healed (or original if no healing needed) content as a single chunk
								const healedContentChunk = {
									id: lastChunkId ?? `chatcmpl-${Date.now()}`,
									object: "chat.completion.chunk",
									created: lastChunkCreated ?? Math.floor(Date.now() / 1000),
									model: lastChunkModel ?? usedInternalModel,
									choices: [
										{
											index: 0,
											delta: {
												content: healingResult.content,
											},
											finish_reason: null,
										},
									],
								};

								await writeSSEAndCache({
									data: JSON.stringify(healedContentChunk),
									id: String(eventId++),
								});

								// Send finish_reason chunk
								const finishChunk = {
									id: lastChunkId ?? `chatcmpl-${Date.now()}`,
									object: "chat.completion.chunk",
									created: lastChunkCreated ?? Math.floor(Date.now() / 1000),
									model: lastChunkModel ?? usedInternalModel,
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: mapFinishReasonToOpenai(
												finishReason,
												usedProvider,
												!!streamingToolCalls && streamingToolCalls.length > 0,
											),
										},
									],
								};

								await writeSSEAndCache({
									data: JSON.stringify(finishChunk),
									id: String(eventId++),
								});
							} catch (error) {
								logger.error(
									"Error sending healed content chunk",
									toError(error),
								);
							}
						}

						// Send routing metadata for all attempts (including successful)
						if (routingAttempts.length > 0 && !doneSent) {
							try {
								const routingChunk = {
									id: `chatcmpl-${Date.now()}`,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: formatUsedModelForDisplay(
										usedProvider,
										usedInternalModel,
										customProviderName,
										usedRegion,
									),
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: null,
										},
									],
									metadata: {
										requested_model: initialRequestedModel,
										requested_provider: requestedProvider ?? null,
										used_model: usedInternalModel,
										used_provider: usedProvider,
										...(usedRegion && { used_region: usedRegion }),
										underlying_used_model: usedInternalModel,
										routing: routingAttempts,
										...buildFinalResponseMetadata(
											streamingCostsEarly.discount ?? null,
										),
									},
								};
								await writeSSEAndCache({
									data: JSON.stringify(routingChunk),
									id: String(eventId++),
								});
							} catch (error) {
								logger.error(
									"Error sending routing metadata chunk",
									toError(error),
								);
							}
						}

						// Always send [DONE] at the end of streaming if not already sent
						if (!doneSent) {
							try {
								await writeSSEAndCache({
									event: "done",
									data: "[DONE]",
									id: String(eventId++),
								});
							} catch (error) {
								logger.error("Error sending [DONE] event", toError(error));
							}
						}
					}

					// Clean up keepalive before any potentially-throwing operations (insertLog, etc.)
					// clearInterval is idempotent so calling it multiple times is safe
					clearKeepalive();

					if (splitTaggedReasoning && !fullReasoningContent) {
						const splitContent = splitReasoningFromTaggedContent(fullContent);
						if (splitContent.reasoningContent) {
							fullContent = splitContent.content ?? "";
							fullReasoningContent = splitContent.reasoningContent;
						}
					}

					// Reuse costs calculated earlier (before usage chunk was sent)
					// If we came through the error path (hasEmptyResponse), calculate now
					const billCancelledRequests = shouldBillCancelledRequests();
					const costs =
						streamingCostsEarly ??
						(canceled && !billCancelledRequests
							? {
									inputCost: null,
									outputCost: null,
									cachedInputCost: null,
									cacheWriteInputCost: null,
									requestCost: null,
									webSearchCost: null,
									contentFilterCost: null,
									imageInputTokens: null,
									imageOutputTokens: null,
									imageInputCost: null,
									imageOutputCost: null,
									audioInputTokens: null,
									audioInputCost: null,
									totalCost: null,
									promptTokens: null,
									completionTokens: null,
									cachedTokens: null,
									cacheWriteTokens: null,
									estimatedCost: false,
									discount: undefined,
									pricingTier: undefined,
									dataStorageCost: null as number | null,
								}
							: await calculateCosts(
									usedInternalModel,
									usedProvider,
									usedRegion ?? null,
									calculatedPromptTokens,
									calculatedCompletionTokens,
									cachedTokens,
									{
										prompt: messages
											.map((m) => messageContentToString(m.content))
											.join("\n"),
										completion: fullContent,
										toolResults: streamingToolCalls ?? undefined,
									},
									reasoningTokens,
									outputImageCount,
									image_config?.image_size,
									inputImageCount,
									webSearchCount,
									project.organizationId,
									image_config?.image_quality,
									null,
									null,
									{
										cacheWriteTokens: cacheCreationTokens,
										cacheWrite1hTokens: cacheCreation1hTokens,
										audioInputTokens,
										cachedAudioInputTokens,
										explicitCacheUsed,
										servedServiceTier,
									},
									finishReason === "content_filter",
								));

					// Use costs.promptTokens as canonical value (includes image input
					// tokens for providers that exclude them from upstream usage)
					if (costs.promptTokens !== null && costs.promptTokens !== undefined) {
						const promptDelta =
							(costs.promptTokens ?? 0) - (calculatedPromptTokens ?? 0);
						if (promptDelta > 0) {
							calculatedPromptTokens = costs.promptTokens;
							calculatedTotalTokens =
								(calculatedTotalTokens ?? 0) + promptDelta;
						}
					}

					// Extract plugin IDs for logging
					const streamingPluginIds = plugins?.map((p) => p.id) ?? [];

					// Determine plugin results for logging (includes healing results if applicable)
					const finalPluginResults =
						Object.keys(streamingPluginResults).length > 0
							? streamingPluginResults
							: undefined;

					const baseLogEntry = createLogEntry(
						requestId,
						project,
						apiKey,
						providerKey?.id,
						usedModelFormatted,
						usedModelMapping,
						usedProvider,
						initialRequestedModel,
						requestedProvider,
						messages,
						temperature,
						max_tokens,
						top_p,
						frequency_penalty,
						presence_penalty,
						reasoning_effort,
						reasoning_max_tokens,
						effort,
						response_format,
						tools,
						tool_choice,
						source,
						customHeaders,
						debugMode,
						userAgent,
						image_config,
						routingMetadata,
						rawBody,
						streamingError ?? streamingRawResponseData, // Raw SSE data sent back to the client
						requestBody, // The request sent to the provider
						streamingError ?? rawUpstreamData, // Raw streaming data received from upstream provider
						streamingPluginIds,
						finalPluginResults, // Plugin results including healing (if enabled)
					);

					// Enhanced logging for Google models streaming to debug missing responses
					if (isGoogleCompatibleProvider(usedProvider)) {
						logger.debug("Google model streaming response completed", {
							usedProvider,
							usedInternalModel,
							hasContent: !!fullContent,
							contentLength: fullContent.length,
							finishReason,
							promptTokens: calculatedPromptTokens,
							completionTokens: calculatedCompletionTokens,
							totalTokens: calculatedTotalTokens,
							reasoningTokens,
							streamingError: streamingError ? String(streamingError) : null,
							canceled,
							hasToolCalls:
								!!streamingToolCalls && streamingToolCalls.length > 0,
						});
					}

					// For cancelled requests, determine if we should include token counts for billing
					const shouldIncludeTokensForBilling =
						!canceled || (canceled && billCancelledRequests);

					const streamingErrorStatusCode =
						typeof streamingError === "object" &&
						streamingError !== null &&
						"details" in streamingError &&
						typeof streamingError.details === "object" &&
						streamingError.details !== null &&
						"statusCode" in streamingError.details &&
						typeof streamingError.details.statusCode === "number"
							? streamingError.details.statusCode
							: 500;

					await insertLogEntry({
						...baseLogEntry,
						id: finalLogId,
						duration,
						timeToFirstToken,
						timeToFirstReasoningToken,
						responseSize: fullContent.length,
						content: fullContent,
						reasoningContent: fullReasoningContent || null,
						finishReason: canceled ? "canceled" : finishReason,
						promptTokens: shouldIncludeTokensForBilling
							? (calculatedPromptTokens?.toString() ?? null)
							: null,
						completionTokens: shouldIncludeTokensForBilling
							? (calculatedCompletionTokens?.toString() ?? null)
							: null,
						totalTokens: shouldIncludeTokensForBilling
							? (calculatedTotalTokens?.toString() ?? null)
							: null,
						reasoningTokens: shouldIncludeTokensForBilling
							? (calculatedReasoningTokens?.toString() ?? null)
							: null,
						cachedTokens: shouldIncludeTokensForBilling
							? (cachedTokens?.toString() ?? null)
							: null,
						cacheWriteTokens: shouldIncludeTokensForBilling
							? (cacheCreationTokens?.toString() ?? null)
							: null,
						hasError: streamingError !== null,
						errorDetails: streamingError
							? {
									statusCode: streamingErrorStatusCode,
									statusText:
										typeof streamingError === "object" &&
										streamingError !== null &&
										"details" in streamingError &&
										typeof streamingError.details === "object" &&
										streamingError.details !== null &&
										"statusText" in streamingError.details &&
										typeof streamingError.details.statusText === "string"
											? streamingError.details.statusText
											: "Streaming Error",
									responseText:
										typeof streamingError === "object" &&
										streamingError !== null &&
										"details" in streamingError &&
										typeof streamingError.details === "object" &&
										streamingError.details !== null &&
										"responseText" in streamingError.details &&
										typeof streamingError.details.responseText === "string"
											? streamingError.details.responseText
											: typeof streamingError === "object" &&
												  streamingError !== null &&
												  "details" in streamingError
												? JSON.stringify(streamingError)
												: streamingError instanceof Error
													? streamingError.message
													: String(streamingError),
								}
							: null,
						streamed: true,
						canceled: canceled,
						inputCost: costs.inputCost,
						outputCost: costs.outputCost,
						cachedInputCost: costs.cachedInputCost,
						cacheWriteInputCost: costs.cacheWriteInputCost,
						requestCost: costs.requestCost,
						webSearchCost: costs.webSearchCost,
						contentFilterCost: costs.contentFilterCost ?? null,
						imageInputTokens: costs.imageInputTokens?.toString() ?? null,
						imageOutputTokens: costs.imageOutputTokens?.toString() ?? null,
						imageInputCost: costs.imageInputCost ?? null,
						imageOutputCost: costs.imageOutputCost ?? null,
						audioInputTokens: costs.audioInputTokens?.toString() ?? null,
						audioInputCost: costs.audioInputCost ?? null,
						cost: costs.totalCost,
						estimatedCost: costs.estimatedCost,
						discount: costs.discount,
						pricingTier: costs.pricingTier,
						serviceTier: servedServiceTier,
						dataStorageCost: shouldIncludeTokensForBilling
							? calculateDataStorageCost(
									calculatedPromptTokens,
									cachedTokens,
									calculatedCompletionTokens,
									calculatedReasoningTokens,
									retentionLevel,
								)
							: "0",
						cached: false,
						tools,
						toolResults: streamingToolCalls,
						toolChoice: tool_choice,
					});

					// Report key health for the selected token source
					if (envVarName !== undefined) {
						if (streamingError !== null) {
							reportKeyError(
								envVarName,
								configIndex,
								streamingErrorStatusCode,
								undefined,
								usedInternalModel,
							);
						} else {
							reportKeySuccess(envVarName, configIndex, usedInternalModel);
						}
					}
					if (trackedKeyHealthId) {
						if (streamingError !== null) {
							reportTrackedKeyError(
								trackedKeyHealthId,
								streamingErrorStatusCode,
								undefined,
								usedInternalModel,
							);
						} else {
							reportTrackedKeySuccess(trackedKeyHealthId, usedInternalModel);
						}
					}

					// Save streaming cache if enabled and not canceled and no errors
					if (
						cachingEnabled &&
						streamingCacheKey &&
						!canceled &&
						finishReason &&
						!streamingError
					) {
						try {
							const streamingCacheData = {
								chunks: streamingChunks,
								metadata: {
									model: usedInternalModel,
									provider: usedProvider,
									finishReason: finishReason,
									totalChunks: streamingChunks.length,
									duration: duration,
									completed: true,
								},
							};

							await setStreamingCache(
								streamingCacheKey,
								streamingCacheData,
								cacheDuration,
							);
						} catch (error) {
							logger.error("Error saving streaming cache", toError(error));
						}
					}
				}
			},
			async (error) => {
				if (error.name === "TimeoutError") {
					logger.warn("Streaming request timeout (escaped handler)", {
						message: error.message,
						path: c.req.path,
					});
				} else if (error.name === "AbortError") {
					logger.info("Streaming request aborted by client (escaped handler)", {
						message: error.message,
						path: c.req.path,
					});
				} else {
					logger.error("Streaming request error (escaped handler)", error);
				}
			},
		);
	}

	// Handle non-streaming response
	const controller = new AbortController();
	// Set up a listener for the request being aborted
	const onAbort = () => {
		if (requestCanBeCanceled) {
			controller.abort();
		}
	};

	// Add event listener for the 'close' event on the connection
	c.req.raw.signal.addEventListener("abort", onAbort);

	// --- Retry loop for provider fallback ---
	const routingAttempts: RoutingAttempt[] = [];
	const failedProviderIds = new Set<string>();
	let canceled = false;
	let fetchError: Error | null = null;
	let isTimeoutFetchError = false;
	let res: Response | undefined;
	let duration = 0;
	for (
		let retryAttempt = 0;
		retryAttempt <= routingCfg.retry.maxRetries;
		retryAttempt++
	) {
		const perAttemptStartTime = Date.now();

		// Type guard: narrow variables that TypeScript widens due to loop reassignment
		if (
			!usedProvider ||
			!usedToken ||
			!url ||
			!usedModelFormatted ||
			!usedModelMapping
		) {
			throw new Error("Provider context not initialized");
		}

		if (retryAttempt > 0) {
			// Re-add abort listener (finally block removes it)
			c.req.raw.signal.addEventListener("abort", onAbort);

			const nextProvider = selectNextProvider(
				routingMetadata?.providerScores ?? [],
				failedProviderIds,
				iamFilteredModelProviders,
			);
			if (!nextProvider) {
				break;
			}

			// Check and consume a rate-limit slot for the fallback candidate.
			// Using checkProviderRateLimit (not peek) so RPM/RPD counters include
			// requests routed to a provider via fallback, not just the initial pick.
			const retryRateLimitResult = await checkProviderRateLimit(
				project.organizationId,
				nextProvider.providerId,
				modelInfo.id,
			);
			if (retryRateLimitResult.rateLimited) {
				failedProviderIds.add(
					providerRetryKey(nextProvider.providerId, nextProvider.region),
				);
				const scoreEntry = routingMetadata?.providerScores.find(
					(s) => s.providerId === nextProvider.providerId,
				);
				if (scoreEntry) {
					scoreEntry.rate_limited = true;
				}
				retryAttempt--;
				continue;
			}

			try {
				const ctx = await resolveProviderContextForRetry(nextProvider, stream);
				applyResolvedProviderContext(ctx);
			} catch {
				failedProviderIds.add(
					providerRetryKey(nextProvider.providerId, nextProvider.region),
				);
				// Don't consume a retry slot for context-resolution failures
				retryAttempt--;
				continue;
			}
		}

		// Reset per-attempt state
		canceled = false;
		fetchError = null;
		isTimeoutFetchError = false;
		res = undefined;

		try {
			const forwardedServiceTier = getForwardedServiceTier(
				usedInternalModel,
				usedProvider,
				usedRegion,
				service_tier,
				configIndex,
			);
			const headers = getProviderHeaders(usedProvider, usedToken, {
				requestId,
				webSearchEnabled: !!webSearchTool,
				serviceTier: forwardedServiceTier,
			});
			if (!(requestBody instanceof FormData)) {
				headers["Content-Type"] = "application/json";
			}

			// Add the effort beta header whenever the outgoing body uses Anthropic's
			// effort-based reasoning fields — triggered by the explicit `effort` param
			// or by a `reasoning_effort` mapped onto an adaptive model (Opus 4.7+).
			if (anthropicRequestNeedsEffortBeta(usedProvider, requestBody)) {
				const currentBeta = headers["anthropic-beta"];
				headers["anthropic-beta"] = currentBeta
					? `${currentBeta},effort-2025-11-24`
					: "effort-2025-11-24";
			}

			// Add structured outputs beta header for Anthropic if json_schema response_format is specified
			if (
				usedProvider === "anthropic" &&
				response_format?.type === "json_schema"
			) {
				const currentBeta = headers["anthropic-beta"];
				headers["anthropic-beta"] = currentBeta
					? `${currentBeta},structured-outputs-2025-11-13`
					: "structured-outputs-2025-11-13";
			}

			// Create a combined signal for both timeout and cancellation
			// Non-streaming requests use a shorter timeout (default 80s).
			// When we're forcing upstream SSE for openai/azure gpt-image-* (to
			// dodge Azure's 122s sync wall), use the longer streaming timeout.
			const fetchSignal = forceImageStreamUpstream
				? createStreamingCombinedSignal(
						requestCanBeCanceled ? controller : undefined,
						routingCfg,
					)
				: createCombinedSignal(
						requestCanBeCanceled ? controller : undefined,
						routingCfg,
					);

			// For the Gemini Developer API the processing tier is a body field;
			// Vertex uses a header set above in getProviderHeaders.
			applyGoogleServiceTier(requestBody, usedProvider, forwardedServiceTier);

			res = await fetch(url, {
				method: "POST",
				headers,
				body:
					requestBody instanceof FormData
						? requestBody
						: JSON.stringify(requestBody),
				signal: fetchSignal,
			});

			logServiceTierRequest(usedProvider, forwardedServiceTier, res);
			// AI Studio reports the served tier in a response header; Vertex reports
			// it later in usageMetadata.trafficType (set below).
			servedServiceTier = resolveServedServiceTier({
				serviceTierHeader: res?.headers.get("x-gemini-service-tier"),
			});
		} catch (error) {
			// Check for timeout error first (AbortSignal.timeout throws TimeoutError)
			if (isTimeoutError(error)) {
				// Capture timeout as a fetch error for logging
				fetchError =
					error instanceof Error ? error : new Error("Request timeout");
				isTimeoutFetchError = true;
			} else if (error instanceof Error && error.name === "AbortError") {
				canceled = true;
			} else if (error instanceof Error) {
				// Capture fetch errors (connection failures, etc.)
				fetchError = error;
			} else {
				throw error;
			}
		} finally {
			// Clean up the event listener
			c.req.raw.signal.removeEventListener("abort", onAbort);
		}

		const perAttemptDuration = Date.now() - perAttemptStartTime;
		duration = Date.now() - startTime;

		// Handle fetch errors (timeout, connection failures, etc.)
		if (fetchError) {
			const errorMessage = fetchError.message;
			const nonStreamingFetchCause = extractErrorCause(fetchError);
			logger.warn("Fetch error", {
				error: errorMessage,
				cause: nonStreamingFetchCause,
				usedProvider,
				requestedProvider,
				usedInternalModel,
				initialRequestedModel,
				unifiedFinishReason: getUnifiedFinishReason(
					"upstream_error",
					usedProvider,
				),
			});

			// Log the error in the database
			// Extract plugin IDs for logging (non-streaming fetch error)
			const nonStreamingFetchErrorPluginIds = plugins?.map((p) => p.id) ?? [];

			// Check if we should retry before logging so we can mark the log as retried
			let sameProviderRetryContext: Awaited<
				ReturnType<typeof resolveProviderContext>
			> | null = null;
			if (isRetryableErrorType("network_error")) {
				rememberFailedKey(usedProvider, usedRegion, {
					envVarName,
					configIndex,
					providerKeyId: providerKey?.id,
				});
				sameProviderRetryContext =
					await tryResolveAlternateKeyForCurrentProvider(stream);
			}

			const willRetryFetchNonStreaming = shouldRetryRequest({
				requestedProvider,
				noFallback,
				errorType: "network_error",
				retryCount: retryAttempt,
				remainingProviders:
					(routingMetadata?.providerScores.length ?? 0) -
					failedProviderIds.size -
					1,
				usedProvider,
				maxRetries: routingCfg.retry.maxRetries,
			});
			const willRetrySameProvider = sameProviderRetryContext !== null;
			const willRetryRequest =
				willRetrySameProvider || willRetryFetchNonStreaming;

			const baseLogEntry = createLogEntry(
				requestId,
				project,
				apiKey,
				providerKey?.id,
				usedModelFormatted,
				usedModelMapping,
				usedProvider,
				initialRequestedModel,
				requestedProvider,
				messages,
				temperature,
				max_tokens,
				top_p,
				frequency_penalty,
				presence_penalty,
				reasoning_effort,
				reasoning_max_tokens,
				effort,
				response_format,
				tools,
				tool_choice,
				source,
				customHeaders,
				debugMode,
				userAgent,
				image_config,
				routingMetadata,
				rawBody,
				null, // No response for fetch error
				requestBody, // The request that resulted in error
				null, // No upstream response for fetch error
				nonStreamingFetchErrorPluginIds,
				undefined, // No plugin results for error case
			);
			const attemptLogId = shortid();

			await insertLogEntry({
				...baseLogEntry,
				id: attemptLogId,
				duration: perAttemptDuration,
				timeToFirstToken: null, // Not applicable for error case
				timeToFirstReasoningToken: null, // Not applicable for error case
				responseSize: 0,
				content: null,
				reasoningContent: null,
				finishReason: "upstream_error",
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: true,
				streamed: false,
				canceled: false,
				errorDetails: {
					statusCode: 0,
					statusText: fetchError.name,
					responseText: errorMessage,
					cause: nonStreamingFetchCause,
				},
				cachedInputCost: null,
				requestCost: null,
				webSearchCost: null,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				estimatedCost: false,
				discount: null,
				dataStorageCost: "0",
				cached: false,
				toolResults: null,
				retried: willRetryRequest,
				retriedByLogId: willRetryRequest ? finalLogId : null,
			});

			// Report key health for the selected token source
			if (envVarName !== undefined) {
				reportKeyError(
					envVarName,
					configIndex,
					0,
					undefined,
					usedInternalModel,
				);
			}
			if (trackedKeyHealthId) {
				reportTrackedKeyError(
					trackedKeyHealthId,
					0,
					undefined,
					usedInternalModel,
				);
			}

			if (willRetrySameProvider && sameProviderRetryContext) {
				routingAttempts.push(
					buildRoutingAttempt(
						usedProvider,
						usedInternalModel,
						0,
						getErrorType(0),
						false,
						{
							region: usedRegion,
							apiKeyHash: usedApiKeyHash,
							logId: attemptLogId,
						},
					),
				);
				applyResolvedProviderContext(sameProviderRetryContext);
				retryAttempt--;
				continue;
			}

			if (willRetryFetchNonStreaming) {
				routingAttempts.push(
					buildRoutingAttempt(
						usedProvider,
						usedInternalModel,
						0,
						getErrorType(0),
						false,
						{
							region: usedRegion,
							apiKeyHash: usedApiKeyHash,
							logId: attemptLogId,
						},
					),
				);
				failedProviderIds.add(providerRetryKey(usedProvider, usedRegion));
				continue;
			}

			// Return error response - use 504 for timeouts, 502 for other connection failures
			return c.json(
				{
					error: {
						message: isTimeoutFetchError
							? `Upstream provider timeout: ${errorMessage}`
							: `Failed to connect to provider: ${errorMessage}`,
						type: isTimeoutFetchError ? "upstream_timeout" : "upstream_error",
						param: null,
						code: isTimeoutFetchError ? "timeout" : "fetch_failed",
						requestedProvider,
						usedProvider,
						requestedModel: initialRequestedModel,
						usedInternalModel,
					},
				},
				isTimeoutFetchError ? 504 : 502,
			);
		}

		// If the request was canceled, log it and return a response
		if (canceled) {
			// Log the canceled request
			// Extract plugin IDs for logging (canceled non-streaming)
			const canceledNonStreamingPluginIds = plugins?.map((p) => p.id) ?? [];

			// Calculate costs for cancelled request if billing is enabled
			const billCancelled = shouldBillCancelledRequests();
			let cancelledCosts: Awaited<ReturnType<typeof calculateCosts>> | null =
				null;
			let estimatedPromptTokens: number | null = null;

			if (billCancelled) {
				// Estimate prompt tokens from messages
				const tokenEstimation = estimateTokens(
					usedProvider,
					messages,
					null,
					null,
					null,
				);
				estimatedPromptTokens = tokenEstimation.calculatedPromptTokens;

				// Calculate costs based on prompt tokens only (no completion for non-streaming cancel)
				// If web search tool was enabled, count it as 1 search for billing
				cancelledCosts = await calculateCosts(
					usedInternalModel,
					usedProvider,
					usedRegion ?? null,
					estimatedPromptTokens,
					0, // No completion tokens
					null, // No cached tokens
					{
						prompt: messages
							.map((m) => messageContentToString(m.content))
							.join("\n"),
						completion: "",
					},
					null, // No reasoning tokens
					0, // No output images
					undefined,
					inputImageCount,
					webSearchTool ? 1 : null, // Bill for web search if it was enabled
					project.organizationId,
					undefined, // imageQuality
					null, // reportedImageInputTokens
					null, // reportedImageOutputTokens
					{ servedServiceTier },
				);
			}

			const baseLogEntry = createLogEntry(
				requestId,
				project,
				apiKey,
				providerKey?.id,
				usedModelFormatted,
				usedModelMapping,
				usedProvider,
				initialRequestedModel,
				requestedProvider,
				messages,
				temperature,
				max_tokens,
				top_p,
				frequency_penalty,
				presence_penalty,
				reasoning_effort,
				reasoning_max_tokens,
				effort,
				response_format,
				tools,
				tool_choice,
				source,
				customHeaders,
				debugMode,
				userAgent,
				image_config,
				routingMetadata,
				rawBody,
				null, // No response for canceled request
				requestBody, // The request that was prepared before cancellation
				null, // No upstream response for canceled request
				canceledNonStreamingPluginIds,
				undefined, // No plugin results for canceled request
			);

			await insertLogEntry({
				...baseLogEntry,
				duration,
				timeToFirstToken: null, // Not applicable for canceled request
				timeToFirstReasoningToken: null, // Not applicable for canceled request
				responseSize: 0,
				content: null,
				reasoningContent: null,
				finishReason: "canceled",
				promptTokens: billCancelled
					? (cancelledCosts?.promptTokens ?? estimatedPromptTokens)?.toString()
					: null,
				completionTokens: billCancelled ? "0" : null,
				totalTokens: billCancelled
					? (cancelledCosts?.promptTokens ?? estimatedPromptTokens)?.toString()
					: null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: false,
				streamed: false,
				canceled: true,
				errorDetails: null,
				inputCost: cancelledCosts?.inputCost ?? null,
				outputCost: cancelledCosts?.outputCost ?? null,
				cachedInputCost: cancelledCosts?.cachedInputCost ?? null,
				requestCost: cancelledCosts?.requestCost ?? null,
				webSearchCost: cancelledCosts?.webSearchCost ?? null,
				imageInputTokens: cancelledCosts?.imageInputTokens?.toString() ?? null,
				imageOutputTokens:
					cancelledCosts?.imageOutputTokens?.toString() ?? null,
				imageInputCost: cancelledCosts?.imageInputCost ?? null,
				imageOutputCost: cancelledCosts?.imageOutputCost ?? null,
				audioInputTokens: cancelledCosts?.audioInputTokens?.toString() ?? null,
				audioInputCost: cancelledCosts?.audioInputCost ?? null,
				cost: cancelledCosts?.totalCost ?? null,
				estimatedCost: cancelledCosts?.estimatedCost ?? false,
				discount: cancelledCosts?.discount ?? null,
				dataStorageCost: billCancelled
					? calculateDataStorageCost(
							cancelledCosts?.promptTokens ?? estimatedPromptTokens,
							null,
							0,
							null,
							retentionLevel,
						)
					: "0",
				cached: false,
				toolResults: null,
			});

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
			); // Using 400 status code for client closed request
		}

		if (res && !res.ok) {
			// Get the error response text
			// Body read can throw TimeoutError if the abort signal fires during consumption
			let errorResponseText: string;
			try {
				const rawErrorResponseText = await res.text();
				errorResponseText =
					usedProvider === "aws-bedrock"
						? extractAwsBedrockHttpError(res, rawErrorResponseText)
						: rawErrorResponseText;
			} catch (bodyError) {
				if (isTimeoutError(bodyError)) {
					const errorMessage =
						bodyError instanceof Error
							? bodyError.message
							: "Timeout reading error response body";
					const bodyErrorCause = extractErrorCause(bodyError);
					logger.warn("Timeout reading error response body", {
						usedProvider,
						usedInternalModel,
						status: res.status,
						cause: bodyErrorCause,
						unifiedFinishReason: getUnifiedFinishReason(
							"upstream_error",
							usedProvider,
						),
					});

					const bodyTimeoutPluginIds = plugins?.map((p) => p.id) ?? [];
					const baseLogEntry = createLogEntry(
						requestId,
						project,
						apiKey,
						providerKey?.id,
						usedModelFormatted,
						usedModelMapping!,
						usedProvider!,
						initialRequestedModel,
						requestedProvider,
						messages,
						temperature,
						max_tokens,
						top_p,
						frequency_penalty,
						presence_penalty,
						reasoning_effort,
						reasoning_max_tokens,
						effort,
						response_format,
						tools,
						tool_choice,
						source,
						customHeaders,
						debugMode,
						userAgent,
						image_config,
						routingMetadata,
						rawBody,
						null,
						requestBody,
						null,
						bodyTimeoutPluginIds,
						undefined,
					);

					await insertLogEntry({
						...baseLogEntry,
						duration: Date.now() - perAttemptStartTime,
						timeToFirstToken: null,
						timeToFirstReasoningToken: null,
						responseSize: 0,
						content: null,
						reasoningContent: null,
						finishReason: "upstream_error",
						promptTokens: null,
						completionTokens: null,
						totalTokens: null,
						reasoningTokens: null,
						cachedTokens: null,
						hasError: true,
						streamed: false,
						canceled: false,
						errorDetails: {
							statusCode: res.status,
							statusText: "TimeoutError",
							responseText: errorMessage,
							cause: bodyErrorCause,
						},
						cachedInputCost: null,
						requestCost: null,
						webSearchCost: null,
						imageInputTokens: null,
						imageOutputTokens: null,
						imageInputCost: null,
						imageOutputCost: null,
						estimatedCost: false,
						discount: null,
						dataStorageCost: "0",
						cached: false,
						toolResults: null,
					});

					return c.json(
						{
							error: {
								message: `Upstream provider timeout: ${errorMessage}`,
								type: "upstream_timeout",
								param: null,
								code: "timeout",
							},
						},
						504,
					);
				}
				throw bodyError;
			}

			// If the upstream Google provider rejected the request because the
			// document MIME isn't supported by that specific model, re-emit as a
			// typed error so app.ts:onError returns a clean 400.
			if (hasDocuments) {
				const documentErr = parseGoogleUpstreamDocumentError(
					errorResponseText,
					usedProvider,
				);
				if (documentErr) {
					throw documentErr;
				}
			}

			// Determine the finish reason first
			const finishReason = getFinishReasonFromError(
				res.status,
				errorResponseText,
			);

			if (
				finishReason !== "client_error" &&
				finishReason !== "content_filter"
			) {
				logger.warn("Provider error", {
					status: res.status,
					errorText: errorResponseText,
					usedProvider,
					requestedProvider,
					usedInternalModel,
					initialRequestedModel,
					organizationId: project.organizationId,
					projectId: apiKey.projectId,
					apiKeyId: apiKey.id,
					unifiedFinishReason: getUnifiedFinishReason(
						finishReason,
						usedProvider,
					),
				});
			}

			// Log the request in the database
			// Extract plugin IDs for logging
			const providerErrorPluginIds = plugins?.map((p) => p.id) ?? [];

			let sameProviderRetryContext: Awaited<
				ReturnType<typeof resolveProviderContext>
			> | null = null;
			if (
				shouldRetryAlternateKey(finishReason, res.status, errorResponseText)
			) {
				rememberFailedKey(usedProvider, usedRegion, {
					envVarName,
					configIndex,
					providerKeyId: providerKey?.id,
				});
				sameProviderRetryContext =
					await tryResolveAlternateKeyForCurrentProvider(stream);
			}

			// Check if we should retry before logging so we can mark the log as retried
			const willRetryHttpNonStreaming = shouldRetryRequest({
				requestedProvider,
				noFallback,
				errorType: finishReason,
				retryCount: retryAttempt,
				remainingProviders:
					(routingMetadata?.providerScores.length ?? 0) -
					failedProviderIds.size -
					1,
				usedProvider,
				maxRetries: routingCfg.retry.maxRetries,
			});
			const willRetrySameProvider = sameProviderRetryContext !== null;
			const willRetryRequest =
				willRetrySameProvider || willRetryHttpNonStreaming;

			const baseLogEntry = createLogEntry(
				requestId,
				project,
				apiKey,
				providerKey?.id,
				usedModelFormatted,
				usedModelMapping,
				usedProvider,
				initialRequestedModel,
				requestedProvider,
				messages,
				temperature,
				max_tokens,
				top_p,
				frequency_penalty,
				presence_penalty,
				reasoning_effort,
				reasoning_max_tokens,
				effort,
				response_format,
				tools,
				tool_choice,
				source,
				customHeaders,
				debugMode,
				userAgent,
				image_config,
				routingMetadata,
				rawBody,
				errorResponseText, // Our formatted error response
				requestBody, // The request that resulted in error
				errorResponseText, // Raw upstream error response
				providerErrorPluginIds,
				undefined, // No plugin results for error case
			);
			const attemptLogId = shortid();

			const nonStreamContentFilterPromptTokens =
				finishReason === "content_filter"
					? (estimateTokens(usedProvider, messages, null, null, 0)
							.calculatedPromptTokens ?? null)
					: null;
			const nonStreamContentFilterCosts =
				finishReason === "content_filter"
					? await calculateCosts(
							usedInternalModel,
							usedProvider,
							usedRegion ?? null,
							Math.max(1, Math.round(nonStreamContentFilterPromptTokens ?? 1)),
							0,
							null,
							{
								prompt: messages
									.map((m) => messageContentToString(m.content))
									.join("\n"),
								completion: "",
							},
							null,
							0,
							image_config?.image_size,
							inputImageCount,
							0,
							project.organizationId,
							image_config?.image_quality,
							null,
							null,
							{ servedServiceTier },
							true,
						)
					: null;

			await insertLogEntry({
				...baseLogEntry,
				id: attemptLogId,
				duration: perAttemptDuration,
				timeToFirstToken: null, // Not applicable for error case
				timeToFirstReasoningToken: null, // Not applicable for error case
				responseSize: errorResponseText.length,
				content: null,
				reasoningContent: null,
				finishReason,
				promptTokens: nonStreamContentFilterPromptTokens?.toString() ?? null,
				completionTokens: null,
				totalTokens: nonStreamContentFilterPromptTokens?.toString() ?? null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: finishReason !== "content_filter", // content_filter is not an error
				streamed: false,
				canceled: false,
				errorDetails: (() => {
					// content_filter is not an error, no error details needed
					if (finishReason === "content_filter") {
						return null;
					}
					// For client errors, try to parse the original error and include the message
					if (finishReason === "client_error") {
						try {
							const originalError = JSON.parse(errorResponseText);
							return {
								statusCode: res.status,
								statusText: res.statusText,
								responseText: errorResponseText,
								message: originalError.error?.message ?? errorResponseText,
							};
						} catch {
							// If parsing fails, use default format
						}
					}
					return {
						statusCode: res.status,
						statusText: res.statusText,
						responseText: errorResponseText,
					};
				})(),
				cost: nonStreamContentFilterCosts?.totalCost ?? null,
				inputCost: nonStreamContentFilterCosts?.inputCost ?? null,
				outputCost: nonStreamContentFilterCosts?.outputCost ?? null,
				cachedInputCost: nonStreamContentFilterCosts?.cachedInputCost ?? null,
				requestCost: nonStreamContentFilterCosts?.requestCost ?? null,
				webSearchCost: nonStreamContentFilterCosts?.webSearchCost ?? null,
				contentFilterCost:
					nonStreamContentFilterCosts?.contentFilterCost ?? null,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: nonStreamContentFilterCosts?.imageInputCost ?? null,
				imageOutputCost: nonStreamContentFilterCosts?.imageOutputCost ?? null,
				estimatedCost: nonStreamContentFilterCosts?.estimatedCost ?? false,
				discount: nonStreamContentFilterCosts?.discount ?? null,
				dataStorageCost: "0",
				cached: false,
				toolResults: null,
				retried: willRetryRequest,
				retriedByLogId: willRetryRequest ? finalLogId : null,
			});

			// Report key health for the selected token source
			// Don't report content_filter as a key error - it's intentional provider behavior
			if (envVarName !== undefined && finishReason !== "content_filter") {
				reportKeyError(
					envVarName,
					configIndex,
					res.status,
					errorResponseText,
					usedInternalModel,
				);
			}
			if (trackedKeyHealthId && finishReason !== "content_filter") {
				reportTrackedKeyError(
					trackedKeyHealthId,
					res.status,
					errorResponseText,
					usedInternalModel,
				);
			}

			if (willRetrySameProvider && sameProviderRetryContext) {
				routingAttempts.push(
					buildRoutingAttempt(
						usedProvider,
						usedInternalModel,
						res.status,
						getErrorType(res.status),
						false,
						{
							region: usedRegion,
							apiKeyHash: usedApiKeyHash,
							logId: attemptLogId,
						},
					),
				);
				applyResolvedProviderContext(sameProviderRetryContext);
				retryAttempt--;
				continue;
			}

			if (willRetryHttpNonStreaming) {
				routingAttempts.push(
					buildRoutingAttempt(
						usedProvider,
						usedInternalModel,
						res.status,
						getErrorType(res.status),
						false,
						{
							region: usedRegion,
							apiKeyHash: usedApiKeyHash,
							logId: attemptLogId,
						},
					),
				);
				failedProviderIds.add(providerRetryKey(usedProvider, usedRegion));
				continue;
			}

			// For content_filter, return a proper completion response (not an error)
			// This handles Azure ResponsibleAIPolicyViolation and similar content filtering errors
			if (finishReason === "content_filter") {
				const cfPromptTokens = Math.max(
					1,
					Math.round(nonStreamContentFilterPromptTokens ?? 1),
				);
				const contentFilterUsage: Record<string, any> = {
					prompt_tokens: cfPromptTokens,
					completion_tokens: 0,
					total_tokens: cfPromptTokens,
				};
				if (nonStreamContentFilterCosts) {
					applyExtendedUsageFields(contentFilterUsage, {
						costs: {
							inputCost: nonStreamContentFilterCosts.inputCost,
							outputCost: nonStreamContentFilterCosts.outputCost,
							cachedInputCost: nonStreamContentFilterCosts.cachedInputCost,
							requestCost: nonStreamContentFilterCosts.requestCost,
							webSearchCost: nonStreamContentFilterCosts.webSearchCost,
							contentFilterCost: nonStreamContentFilterCosts.contentFilterCost,
							imageInputCost: nonStreamContentFilterCosts.imageInputCost,
							imageOutputCost: nonStreamContentFilterCosts.imageOutputCost,
							totalCost: nonStreamContentFilterCosts.totalCost,
						},
						cachedTokens: null,
						cacheCreationTokens: null,
						reasoningTokens: null,
					});
				}
				return c.json({
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: formatUsedModelForDisplay(
						usedProvider,
						usedInternalModel,
						customProviderName,
						usedRegion,
					),
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: null,
							},
							finish_reason: "content_filter",
						},
					],
					usage: contentFilterUsage,
					metadata: {
						request_id: requestId,
						requested_model: initialRequestedModel,
						requested_provider: requestedProvider,
						used_model: usedInternalModel,
						used_provider: usedProvider,
						...(usedRegion && { used_region: usedRegion }),
						underlying_used_model: usedInternalModel,
					},
				});
			}

			// For client errors, return the original provider error response
			if (finishReason === "client_error") {
				try {
					const originalError = JSON.parse(errorResponseText);
					return c.json(originalError, res.status as 400);
				} catch {
					// If we can't parse the original error, fall back to our format
				}
			}

			// Return our wrapped error response for non-client errors
			return c.json(
				{
					error: {
						message: `Error from provider ${usedProvider}: ${res.status} ${res.statusText} ${errorResponseText}`,
						type: finishReason,
						param: null,
						code: finishReason,
						requestedProvider,
						usedProvider,
						requestedModel: initialRequestedModel,
						usedInternalModel,
						responseText: errorResponseText,
					},
				},
				500,
			);
		}

		break; // Fetch succeeded, exit retry loop
	} // End of retry for loop

	// Add the final attempt (successful or last failed) to routing
	if (res && res.ok && usedProvider) {
		routingAttempts.push(
			buildRoutingAttempt(
				usedProvider,
				usedInternalModel,
				res.status,
				"none",
				true,
				{
					region: usedRegion,
					apiKeyHash: usedApiKeyHash,
					logId: finalLogId,
				},
			),
		);
	}

	// Update routingMetadata with all routing attempts for DB logging
	if (routingMetadata) {
		// Enrich providerScores with failure info from routing attempts
		const failedMap = new Map(
			routingAttempts.filter((a) => !a.succeeded).map((f) => [f.provider, f]),
		);
		routingMetadata = {
			...routingMetadata,
			routing: routingAttempts,
			providerScores: routingMetadata.providerScores.map((score) => {
				const failure = failedMap.get(score.providerId);
				if (failure) {
					return {
						...score,
						failed: true,
						status_code: failure.status_code,
						error_type: failure.error_type,
					};
				}
				return score;
			}),
		};
	}

	if (!res || !res.ok) {
		// All retries exhausted
		return c.json(
			{
				error: {
					message: "All provider attempts failed",
					type: "upstream_error",
					param: null,
					code: "all_providers_failed",
				},
			},
			502,
		);
	}

	// After successful retry loop, all provider variables are guaranteed set
	if (!usedProvider || !url) {
		throw new Error("No provider context after retry loop");
	}

	let json: any;
	try {
		if (forceStream && res.body) {
			// Stream-only model: upstream returned SSE but client expects JSON.
			// Read the full stream and assemble a non-streaming response.
			const text = await res.text();
			const lines = text.split("\n");
			let content = "";
			const toolCalls: any[] = [];
			let finishReason: string | null = null;
			let usage: any = null;
			let responseId = "";
			let model = "";
			let created = 0;

			for (const line of lines) {
				if (!line.startsWith("data: ") || line === "data: [DONE]") {
					continue;
				}
				try {
					const chunk = JSON.parse(line.slice(6));
					if (!responseId && chunk.id) {
						responseId = chunk.id;
					}
					if (!model && chunk.model) {
						model = chunk.model;
					}
					if (!created && chunk.created) {
						created = chunk.created;
					}
					const delta = chunk.choices?.[0]?.delta;
					if (delta?.content) {
						content += delta.content;
					}
					if (delta?.tool_calls) {
						for (const tc of delta.tool_calls) {
							const idx = tc.index ?? 0;
							if (!toolCalls[idx]) {
								toolCalls[idx] = {
									id: tc.id ?? "",
									type: tc.type ?? "function",
									function: { name: tc.function?.name ?? "", arguments: "" },
								};
							} else {
								if (tc.id) {
									toolCalls[idx].id = tc.id;
								}
								if (tc.function?.name) {
									toolCalls[idx].function.name = tc.function.name;
								}
							}
							if (tc.function?.arguments) {
								toolCalls[idx].function.arguments += tc.function.arguments;
							}
						}
					}
					if (chunk.choices?.[0]?.finish_reason) {
						finishReason = chunk.choices[0].finish_reason;
					}
					if (chunk.usage) {
						usage = chunk.usage;
					}
				} catch {
					// skip unparseable lines
				}
			}

			json = {
				id: responseId,
				object: "chat.completion",
				created,
				model,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content || null,
							...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
						},
						finish_reason: finishReason ?? "stop",
					},
				],
				...(usage ? { usage } : {}),
			};
		} else if (forceImageStreamUpstream && res.body) {
			// Upstream is openai/azure gpt-image-* and we forced stream=true
			// to dodge the 122s sync wall. Collapse the SSE back into the
			// normal { data: [{ b64_json }], usage } shape.
			const text = await res.text();
			const collapsed = collapseImageGenSse(text);
			if ("error" in collapsed) {
				const sseErrorText = JSON.stringify(collapsed.error);
				const isContentFilter =
					getFinishReasonFromError(res.status, sseErrorText) ===
					"content_filter";
				const sseLogPluginIds = plugins?.map((p) => p.id) ?? [];
				const sseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModelFormatted!,
					usedModelMapping,
					usedProvider,
					initialRequestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					reasoning_effort,
					reasoning_max_tokens,
					effort,
					response_format,
					tools,
					tool_choice,
					source,
					customHeaders,
					debugMode,
					userAgent,
					image_config,
					routingMetadata,
					rawBody,
					sseErrorText,
					requestBody,
					sseErrorText,
					sseLogPluginIds,
					undefined,
				);

				await insertLogEntry({
					...sseLogEntry,
					duration: Date.now() - startTime,
					timeToFirstToken: null,
					timeToFirstReasoningToken: null,
					responseSize: text.length,
					content: null,
					reasoningContent: null,
					finishReason: isContentFilter ? "content_filter" : "upstream_error",
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: !isContentFilter,
					streamed: false,
					canceled: false,
					errorDetails: isContentFilter
						? null
						: {
								statusCode: res.status,
								statusText: res.statusText,
								responseText: sseErrorText,
							},
					cachedInputCost: null,
					requestCost: null,
					webSearchCost: null,
					imageInputTokens: null,
					imageOutputTokens: null,
					imageInputCost: null,
					imageOutputCost: null,
					estimatedCost: false,
					discount: null,
					dataStorageCost: "0",
					cached: false,
					toolResults: null,
				});

				if (isContentFilter) {
					// OpenAI/Azure returned a moderation rejection inside the SSE
					// stream (e.g. moderation_blocked / "Your request was rejected
					// by the safety system"). Surface it as a normal chat completion
					// with finish_reason: "content_filter" instead of a 502.
					return c.json({
						id: `chatcmpl-${Date.now()}`,
						object: "chat.completion",
						created: Math.floor(Date.now() / 1000),
						model: formatUsedModelForDisplay(
							usedProvider,
							usedInternalModel,
							customProviderName,
							usedRegion,
						),
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: null,
								},
								finish_reason: "content_filter",
							},
						],
						usage: {
							prompt_tokens: 0,
							completion_tokens: 0,
							total_tokens: 0,
						},
						metadata: {
							request_id: requestId,
							requested_model: initialRequestedModel,
							requested_provider: requestedProvider,
							used_model: usedInternalModel,
							used_provider: usedProvider,
							...(usedRegion && { used_region: usedRegion }),
							underlying_used_model: usedInternalModel,
						},
					});
				}

				logger.warn("Image generation SSE collapse failed", {
					usedProvider,
					usedInternalModel,
					code: collapsed.error.code,
					message: collapsed.error.message,
				});
				return c.json(
					{
						error: {
							message: collapsed.error.message,
							type: collapsed.error.type ?? "upstream_error",
							param: null,
							code: collapsed.error.code ?? "upstream_error",
							requestedProvider,
							usedProvider,
							requestedModel: initialRequestedModel,
							usedInternalModel,
						},
					},
					502,
				);
			}
			json = collapsed.json;
		} else {
			json = await res.json();
		}
	} catch (bodyError) {
		if (isTimeoutError(bodyError)) {
			const errorMessage =
				bodyError instanceof Error
					? bodyError.message
					: "Timeout reading response body";
			const bodyReadCause = extractErrorCause(bodyError);
			logger.warn("Timeout reading response body", {
				usedProvider,
				usedInternalModel,
				initialRequestedModel,
				cause: bodyReadCause,
				unifiedFinishReason: getUnifiedFinishReason(
					"upstream_error",
					usedProvider,
				),
			});

			const bodyTimeoutPluginIds = plugins?.map((p) => p.id) ?? [];
			const baseLogEntry = createLogEntry(
				requestId,
				project,
				apiKey,
				providerKey?.id,
				usedModelFormatted!,
				usedModelMapping,
				usedProvider,
				initialRequestedModel,
				requestedProvider,
				messages,
				temperature,
				max_tokens,
				top_p,
				frequency_penalty,
				presence_penalty,
				reasoning_effort,
				reasoning_max_tokens,
				effort,
				response_format,
				tools,
				tool_choice,
				source,
				customHeaders,
				debugMode,
				userAgent,
				image_config,
				routingMetadata,
				rawBody,
				null,
				requestBody,
				null,
				bodyTimeoutPluginIds,
				undefined,
			);

			await insertLogEntry({
				...baseLogEntry,
				duration: Date.now() - startTime,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize: 0,
				content: null,
				reasoningContent: null,
				finishReason: "upstream_error",
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
				hasError: true,
				streamed: false,
				canceled: false,
				errorDetails: {
					statusCode: res.status,
					statusText: "TimeoutError",
					responseText: errorMessage,
					cause: bodyReadCause,
				},
				cachedInputCost: null,
				requestCost: null,
				webSearchCost: null,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				estimatedCost: false,
				discount: null,
				dataStorageCost: "0",
				cached: false,
				toolResults: null,
			});

			return c.json(
				{
					error: {
						message: `Upstream provider timeout: ${errorMessage}`,
						type: "upstream_timeout",
						param: null,
						code: "timeout",
					},
				},
				504,
			);
		}
		throw bodyError;
	}
	if (process.env.NODE_ENV !== "production") {
		logger.debug("API response", { response: json });
	}
	// Track response size - prefer Content-Length header to avoid expensive stringify on large responses
	const contentLengthHeader = res.headers.get("Content-Length");
	let responseSize = contentLengthHeader
		? parseInt(contentLengthHeader, 10)
		: 0;

	logVertexTrafficType(
		usedProvider,
		getForwardedServiceTier(
			usedInternalModel,
			usedProvider,
			usedRegion,
			service_tier,
			configIndex,
		),
		json,
	);
	if (usedProvider === "openai") {
		const served = resolveOpenAIServiceTier(json);
		if (served !== undefined) {
			servedServiceTier = served;
		}
	}
	{
		const served = resolveServedServiceTier({
			trafficType: json?.usageMetadata?.trafficType,
		});
		if (served) {
			servedServiceTier = served;
		}
	}

	// Extract content and token usage based on provider
	const parsedResponse = parseProviderResponse(
		usedProvider,
		usedInternalModel,
		json,
		messages,
		supportsReasoning,
		splitTaggedReasoning,
	);
	let { content, totalTokens } = parsedResponse;
	const {
		reasoningContent,
		finishReason,
		promptTokens,
		completionTokens,
		reasoningTokens,
		cachedTokens,
		cacheCreationTokens,
		cacheCreation5mTokens,
		cacheCreation1hTokens,
		imageInputTokens,
		imageOutputTokens,
		audioInputTokens,
		cachedAudioInputTokens,
		toolResults,
		images,
		annotations,
		webSearchCount,
	} = parsedResponse;

	const responseHealingEnabled = plugins?.some(
		(p) => p.id === "response-healing",
	);
	const isJsonResponseFormat =
		response_format?.type === "json_object" ||
		response_format?.type === "json_schema";

	// Track plugin results for logging
	const pluginResults: {
		responseHealing?: {
			healed: boolean;
			healingMethod?: string;
		};
	} = {};

	const shouldHealNonStreaming =
		isJsonResponseFormat &&
		(responseHealingEnabled === true ||
			((usedProvider === "anthropic" || usedProvider === "vertex-anthropic") &&
				response_format?.type === "json_object") ||
			(usedProvider === "aws-bedrock" &&
				response_format?.type === "json_object") ||
			usedProvider === "novita" ||
			splitTaggedReasoning);

	if (shouldHealNonStreaming && content) {
		const healingResult = healJsonResponse(content);
		pluginResults.responseHealing = {
			healed: healingResult.healed,
			healingMethod: healingResult.healingMethod,
		};
		if (healingResult.healed) {
			logger.debug("Response healing applied", {
				method: healingResult.healingMethod,
				originalLength: healingResult.originalContent.length,
				healedLength: healingResult.content.length,
			});
			content = healingResult.content;
		}
	}

	// Enhanced logging for Google models to debug missing responses
	if (isGoogleCompatibleProvider(usedProvider)) {
		logger.debug("Google model response parsed", {
			usedProvider,
			usedInternalModel,
			hasContent: !!content,
			contentLength: content?.length ?? 0,
			finishReason,
			promptTokens,
			completionTokens,
			reasoningTokens,
			hasToolResults: !!toolResults,
			toolResultsCount: toolResults?.length ?? 0,
			rawCandidates: json.candidates,
			rawUsageMetadata: json.usageMetadata,
		});
	}

	// Debug: Log images found in response
	logger.debug("Gateway - parseProviderResponse extracted images", { images });
	logger.debug("Gateway - Used provider", { usedProvider });
	logger.debug("Gateway - Used model", { usedInternalModel });

	// Convert external image URLs to base64 data URLs
	// This ensures consistent response format across all providers
	// The conversion function checks if already in data: format and skips if so
	let convertedImages = images;
	if (images && images.length > 0) {
		convertedImages = await convertImagesToBase64(images);
		logger.debug("Gateway - Converted images to base64", {
			provider: usedProvider,
			originalCount: images.length,
			convertedCount: convertedImages.length,
		});
	}

	// Estimate tokens if not provided by the API
	const estimatedTokens = estimateTokens(
		usedProvider,
		messages,
		content,
		promptTokens,
		completionTokens,
	);
	let calculatedPromptTokens = estimatedTokens.calculatedPromptTokens;
	const calculatedCompletionTokens = estimatedTokens.calculatedCompletionTokens;

	// Estimate reasoning tokens if not provided but reasoning content exists
	let calculatedReasoningTokens = reasoningTokens;
	if (!reasoningTokens && reasoningContent) {
		calculatedReasoningTokens = estimateTokensFromContent(reasoningContent);
	}
	const costs = await calculateCosts(
		usedInternalModel,
		usedProvider,
		usedRegion ?? null,
		calculatedPromptTokens,
		calculatedCompletionTokens,
		cachedTokens,
		{
			prompt: messages.map((m) => messageContentToString(m.content)).join("\n"),
			completion: content,
			toolResults: toolResults,
		},
		reasoningTokens,
		convertedImages?.length || 0,
		image_config?.image_size,
		inputImageCount,
		webSearchCount,
		project.organizationId,
		image_config?.image_quality,
		imageInputTokens,
		imageOutputTokens,
		{
			cacheWriteTokens: cacheCreationTokens,
			cacheWrite1hTokens: cacheCreation1hTokens,
			audioInputTokens,
			cachedAudioInputTokens,
			explicitCacheUsed,
			servedServiceTier,
		},
		finishReason === "content_filter",
	);

	// Anthropic-family refusal that produced no output is not billed (per
	// Anthropic's policy: a refusal before any generated output is informational
	// only). A refusal that already produced content is billed normally. This is
	// applied before transformResponseToOpenai so the cost echoed back to the
	// client also reflects the zeroed charge.
	if (
		isRefusalFinishReason(finishReason, usedProvider) &&
		!hasMeaningfulAssistantOutput({
			completionTokens: calculatedCompletionTokens,
			reasoningTokens: calculatedReasoningTokens,
			content,
			toolResults,
			images: convertedImages,
		})
	) {
		zeroInferenceCosts(costs);
	}

	costs.dataStorageCost = toDataStorageCostNumber(
		costs.promptTokens ?? calculatedPromptTokens,
		cachedTokens,
		costs.completionTokens ?? calculatedCompletionTokens,
		calculatedReasoningTokens,
		retentionLevel,
	);

	// Use costs.promptTokens as canonical value (includes image input
	// tokens for providers that exclude them from upstream usage)
	if (costs.promptTokens !== null && costs.promptTokens !== undefined) {
		const promptDelta =
			(costs.promptTokens ?? 0) - (calculatedPromptTokens ?? 0);
		if (promptDelta > 0) {
			calculatedPromptTokens = costs.promptTokens;
			totalTokens = (
				(calculatedPromptTokens ?? 0) +
				(calculatedCompletionTokens ?? 0) +
				(calculatedReasoningTokens ?? 0)
			).toString();
		}
	}

	// Transform response to OpenAI format for non-OpenAI providers
	// Include costs in response for all users
	const shouldIncludeCosts = true;
	const transformedResponse = transformResponseToOpenai(
		usedProvider,
		usedInternalModel,
		json,
		content,
		reasoningContent,
		finishReason,
		costs.promptTokens ?? calculatedPromptTokens,
		costs.completionTokens ?? calculatedCompletionTokens,
		(costs.promptTokens ?? calculatedPromptTokens ?? 0) +
			(costs.completionTokens ?? calculatedCompletionTokens ?? 0) +
			(reasoningTokens ?? 0),
		reasoningTokens,
		cachedTokens,
		toolResults,
		convertedImages,
		modelInput,
		requestedProvider ?? null,
		usedInternalModel,
		shouldIncludeCosts
			? {
					inputCost: costs.inputCost,
					outputCost: costs.outputCost,
					cachedInputCost: costs.cachedInputCost,
					cacheWriteInputCost: costs.cacheWriteInputCost,
					requestCost: costs.requestCost,
					webSearchCost: costs.webSearchCost,
					contentFilterCost: costs.contentFilterCost,
					imageInputCost: costs.imageInputCost,
					imageOutputCost: costs.imageOutputCost,
					audioInputCost: costs.audioInputCost,
					totalCost: costs.totalCost,
					dataStorageCost: costs.dataStorageCost,
				}
			: null,
		false, // showUpgradeMessage
		annotations,
		routingAttempts.length > 0 ? routingAttempts : null,
		requestId,
		usedRegion,
		cacheCreationTokens,
		imageInputTokens,
		imageOutputTokens,
		cacheCreation5mTokens,
		cacheCreation1hTokens,
		audioInputTokens,
		usedProvider === "openai" ? readServiceTierValue(json) : undefined,
	);
	const transformedMetadata =
		transformedResponse.metadata &&
		typeof transformedResponse.metadata === "object"
			? transformedResponse.metadata
			: {};
	transformedResponse.metadata = {
		...transformedMetadata,
		...buildFinalResponseMetadata(costs.discount ?? null),
	};

	// Extract plugin IDs for logging
	const pluginIds = plugins?.map((p) => p.id) ?? [];

	const baseLogEntry = createLogEntry(
		requestId,
		project,
		apiKey,
		providerKey?.id,
		usedModelFormatted,
		usedModelMapping,
		usedProvider,
		initialRequestedModel,
		requestedProvider,
		messages,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		reasoning_effort,
		reasoning_max_tokens,
		effort,
		response_format,
		tools,
		tool_choice,
		source,
		customHeaders,
		debugMode,
		userAgent,
		image_config,
		routingMetadata,
		rawBody,
		transformedResponse, // Our formatted response that we return to user
		requestBody, // The request sent to the provider
		json, // Raw upstream response from provider
		pluginIds,
		Object.keys(pluginResults).length > 0 ? pluginResults : undefined,
	);

	// Check if the non-streaming response is empty (no content, tokens, or tool calls)
	// Exclude content filter responses as they are intentionally empty.
	const isContentFilterResponse = isContentFilterFinishReason(
		finishReason,
		usedProvider,
	);
	const hasEmptyNonStreamingResponse =
		!!finishReason &&
		finishReason !== "incomplete" &&
		!isContentFilterResponse &&
		!hasMeaningfulAssistantOutput({
			completionTokens: calculatedCompletionTokens,
			reasoningTokens: calculatedReasoningTokens,
			content,
			toolResults,
			images: convertedImages,
		});

	if (hasEmptyNonStreamingResponse) {
		logger.debug("Empty non-streaming response detected", {
			finishReason,
			usedProvider,
			usedInternalModel,
			calculatedCompletionTokens,
			contentLength: content?.length ?? 0,
			toolResultsLength: toolResults?.length ?? 0,
			imageCount: convertedImages?.length ?? 0,
		});
	}

	// Calculate response size if Content-Length was not available
	// For large responses, use content length estimation to avoid CPU spikes from stringify
	if (!responseSize) {
		const contentLength = content?.length ?? 0;
		// If content is very large (likely contains base64 images), use estimation
		// Otherwise stringify is acceptable for smaller responses
		if (contentLength > 1_000_000) {
			// Estimate: content + JSON overhead
			responseSize = contentLength + 500;
		} else {
			responseSize = JSON.stringify(json).length;
		}
	}

	// For image generation, store the base64 data URLs in content
	// so the activity detail page can render the images
	const base64Images =
		convertedImages?.filter((img) => img.image_url.url.startsWith("data:")) ??
		[];
	const logContent =
		base64Images.length > 0
			? base64Images.map((img) => img.image_url.url).join("\n")
			: content;

	await insertLogEntry({
		...baseLogEntry,
		id: finalLogId,
		duration,
		timeToFirstToken: null, // Not applicable for non-streaming requests
		timeToFirstReasoningToken: null, // Not applicable for non-streaming requests
		responseSize,
		content: logContent,
		reasoningContent: reasoningContent,
		finishReason: hasEmptyNonStreamingResponse
			? "upstream_error"
			: finishReason,
		promptTokens: calculatedPromptTokens?.toString() ?? null,
		completionTokens: calculatedCompletionTokens?.toString() ?? null,
		totalTokens:
			totalTokens ??
			(
				(calculatedPromptTokens ?? 0) + (calculatedCompletionTokens ?? 0)
			).toString(),
		reasoningTokens: calculatedReasoningTokens?.toString() ?? null,
		cachedTokens: cachedTokens?.toString() ?? null,
		cacheWriteTokens: cacheCreationTokens?.toString() ?? null,
		hasError: hasEmptyNonStreamingResponse,
		streamed: false,
		canceled: false,
		errorDetails: hasEmptyNonStreamingResponse
			? {
					statusCode: 500,
					statusText: "Empty Response",
					responseText:
						"Response finished successfully but returned no content or tool calls",
				}
			: null,
		inputCost: costs.inputCost,
		outputCost: costs.outputCost,
		cachedInputCost: costs.cachedInputCost,
		cacheWriteInputCost: costs.cacheWriteInputCost,
		requestCost: costs.requestCost,
		webSearchCost: costs.webSearchCost,
		contentFilterCost: costs.contentFilterCost ?? null,
		imageInputTokens: costs.imageInputTokens?.toString() ?? null,
		imageOutputTokens: costs.imageOutputTokens?.toString() ?? null,
		imageInputCost: costs.imageInputCost ?? null,
		imageOutputCost: costs.imageOutputCost ?? null,
		audioInputTokens: costs.audioInputTokens?.toString() ?? null,
		audioInputCost: costs.audioInputCost ?? null,
		cost: costs.totalCost,
		estimatedCost: costs.estimatedCost,
		discount: costs.discount,
		pricingTier: costs.pricingTier,
		serviceTier: servedServiceTier,
		dataStorageCost: calculateDataStorageCost(
			calculatedPromptTokens,
			cachedTokens,
			calculatedCompletionTokens,
			calculatedReasoningTokens,
			retentionLevel,
		),
		cached: false,
		tools,
		toolResults,
		toolChoice: tool_choice,
	});

	// Report key health for the selected token source
	// Note: We don't report empty responses as key errors since they're not upstream errors
	if (envVarName !== undefined) {
		reportKeySuccess(envVarName, configIndex, usedInternalModel);
	}
	if (trackedKeyHealthId) {
		reportTrackedKeySuccess(trackedKeyHealthId, usedInternalModel);
	}

	if (cachingEnabled && cacheKey && !stream && !hasEmptyNonStreamingResponse) {
		await setCache(
			cacheKey,
			stripRequestScopedMetadataFromOpenAiResponse(transformedResponse),
			cacheDuration,
		);
	}

	// For image generation models with streaming requested, convert to SSE format
	if (fakeStreamingForImageGen) {
		const streamChunks: string[] = [];

		// Create a streaming chunk that mimics OpenAI SSE format
		const deltaChunk = {
			id: transformedResponse.id ?? `chatcmpl-${Date.now()}`,
			object: "chat.completion.chunk",
			created: transformedResponse.created ?? Math.floor(Date.now() / 1000),
			model: transformedResponse.model,
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						content: transformedResponse.choices?.[0]?.message?.content ?? "",
						...(transformedResponse.choices?.[0]?.message?.images && {
							images: transformedResponse.choices[0].message.images,
						}),
					},
					finish_reason: null,
				},
			],
		};
		streamChunks.push(`data: ${JSON.stringify(deltaChunk)}\n\n`);

		// Send finish chunk
		const finishChunk = {
			id: transformedResponse.id ?? `chatcmpl-${Date.now()}`,
			object: "chat.completion.chunk",
			created: transformedResponse.created ?? Math.floor(Date.now() / 1000),
			model: transformedResponse.model,
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason:
						transformedResponse.choices?.[0]?.finish_reason ?? "stop",
				},
			],
			...(transformedResponse.usage && { usage: transformedResponse.usage }),
			...(transformedResponse.metadata && {
				metadata: transformedResponse.metadata,
			}),
		};
		streamChunks.push(`data: ${JSON.stringify(finishChunk)}\n\n`);
		streamChunks.push("data: [DONE]\n\n");

		return new Response(streamChunks.join(""), {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Request-Id": requestId,
			},
		});
	}

	return c.json(transformedResponse);
});
