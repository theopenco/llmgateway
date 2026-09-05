import { Decimal } from "decimal.js";

import {
	getEffectiveDiscount,
	type ProviderMetrics,
	metricsKey,
} from "@llmgateway/db";
import {
	getProviderDefinition,
	type AvailableModelProvider,
	type ModelWithPricing,
	type ProviderModelMapping,
	resolveTimeBasedPricing,
} from "@llmgateway/models";
import { randomFloat, randomInt } from "@llmgateway/shared/random";
import {
	getDefaultRoutingConfig,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";

import {
	computeWeightedProviderScores,
	getEffectiveScoringWeights,
} from "./compute-provider-scores.js";

import type {
	RoutingCredentialSource,
	RoutingExclusionReason,
} from "@llmgateway/shared/routing-telemetry";

interface ProviderScore<T extends AvailableModelProvider> {
	provider: T;
	score: Decimal;
	price: Decimal;
	routingPrice: Decimal;
	uptime?: number;
	latency?: number;
	throughput?: number;
	cacheSupported?: boolean;
	discount?: Decimal;
}

function getExplorationRate(cfg: ResolvedRoutingConfig): number {
	const rawExplorationRate = process.env.EXPLORATION_RATE;

	if (rawExplorationRate === undefined || rawExplorationRate.trim() === "") {
		return cfg.thresholds.explorationRate;
	}

	const explorationRate = Number(rawExplorationRate);
	if (
		!Number.isFinite(explorationRate) ||
		explorationRate < 0 ||
		explorationRate > 1
	) {
		throw new Error(
			`Invalid EXPLORATION_RATE: "${rawExplorationRate}". Expected a number between 0 and 1.`,
		);
	}

	return explorationRate;
}

function getEffectivePriority(
	providerId: string,
	cfg: ResolvedRoutingConfig,
): number {
	const override = cfg.providerPriorities[providerId];
	if (typeof override === "number") {
		return override;
	}
	const providerDef = getProviderDefinition(providerId);
	return providerDef?.priority ?? 1;
}

function isTestProcess(): boolean {
	if (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST)) {
		return true;
	}

	return process.argv.some((arg) => arg.toLowerCase().includes("vitest"));
}

export interface RoutingMetadata {
	availableProviders: string[];
	selectedProvider: string;
	selectionReason: string;
	usedApiKeyHash?: string;
	// Whose credential the served attempt was sent with: the organization's own
	// provider key (`byok`) or an LLM Gateway platform credential (`platform`).
	// Without it, `usedApiKeyHash` is an opaque fingerprint that gives no hint
	// whether the request was billed to the provider or to credits.
	usedCredentialSource?: RoutingCredentialSource;
	// The organization's own key that served the request, named as its owner
	// sees it. Only set when usedCredentialSource is "byok" — a platform
	// credential is never described to a tenant.
	usedProviderKeyId?: string;
	usedProviderKeyLabel?: string;
	// The organization's own keys that were candidates for the used provider,
	// in selection order, so an operator can see which of their keys the
	// gateway had to choose from. BYOK rows only; never platform credentials.
	eligibleProviderKeys?: Array<{ id: string; label?: string }>;
	providerScores: Array<{
		providerId: string;
		region?: string;
		score: number;
		uptime?: number;
		latency?: number;
		throughput?: number;
		price: number;
		priority?: number;
		cacheSupported?: boolean;
		discount?: number;
		// Populated after retry loop if this provider was attempted and failed
		failed?: boolean;
		status_code?: number;
		error_type?: string;
		// Set when this provider was excluded due to RPM cap
		rate_limited?: boolean;
		// Set when the provider is marked as content-filtered in the provider catalog
		contentFilterProvider?: boolean;
		// Set when the provider was excluded because the gateway content filter matched
		excludedByContentFilter?: boolean;
		// Set when hybrid keyed-provider preference demoted this credits-backed
		// candidate; kept in the scores as a last-resort retry target
		hybrid_demoted?: boolean;
	}>;
	// Optional fields for low-uptime fallback routing
	originalProvider?: string;
	originalProviderUptime?: number;
	// Set when the originally requested provider was rate-limited and fallback occurred
	originalProviderRateLimited?: boolean;
	// Whether fallback was disabled via X-No-Fallback header
	noFallback?: boolean;
	// Whether the request explicitly included an X-No-Fallback header
	xNoFallbackHeaderSet?: boolean;
	// Whether the gateway content filter matched for the request before upstream routing
	contentFilterMatched?: boolean;
	// Whether routing excluded content-filter providers in favor of alternatives
	contentFilterRerouted?: boolean;
	// Providers excluded because they are marked as content-filter providers
	contentFilterExcludedProviders?: string[];
	// All provider attempts from retry fallback mechanism (including successful)
	routing?: Array<{
		provider: string;
		model: string;
		region?: string;
		status_code: number;
		error_type: string;
		succeeded: boolean;
		apiKeyHash?: string;
		// Per attempt, because a single request can switch credential owners
		// mid-flight: in hybrid mode a failing BYOK key falls back to the
		// platform credential, and both attempts land in this array.
		credentialSource?: RoutingCredentialSource;
		providerKeyId?: string;
		providerKeyLabel?: string;
		logId?: string;
	}>;
	// Provider mappings that were filtered out because they don't support requested params/features
	filteredProviders?: Array<{
		providerId: string;
		reasons: string[];
		// Stable RoutingExclusionReason codes for the same exclusions; aggregated
		// per hour into routing_exclusion_hourly.
		codes?: RoutingExclusionReason[];
	}>;
	// Where the requested service tier came from: the request body, or a dev-plan
	// (DevPass) org's configured default tier. Only set when a premium tier was in
	// play — a defaulted tier narrows routing without appearing in the request.
	serviceTierSource?: "request" | "coding-plan-default";
	// Parameters that were stripped from the request because the selected provider doesn't support them
	strippedParameters?: string[];
	// Set when the request was resolved through a named dynamic route
	dynamicRoute?: {
		name: string;
		version: number;
		// Node ids traversed during graph evaluation
		path: string[];
	};
}

export interface ProviderSelectionResult<T extends AvailableModelProvider> {
	provider: T;
	metadata: RoutingMetadata;
}

export interface SessionProviderEntry {
	providerId: string;
	region?: string;
}

/**
 * Persistence backend for sticky-session routing. The gateway implements this
 * with a Redis-backed per-session entry; selection logic stays pure by reading
 * and writing through these callbacks.
 */
export interface SessionProviderStore {
	get: () => Promise<SessionProviderEntry | null>;
	set: (providerId: string, region?: string) => Promise<void>;
}

export interface ProviderSelectionOptions {
	metricsMap?: Map<string, ProviderMetrics>;
	isStreaming?: boolean;
	videoPricing?: VideoPricingContext;
	/**
	 * Estimated prompt tokens for the request. When provided and at or above
	 * the configured cache prompt threshold, cache support is factored into the
	 * weighted score.
	 */
	promptTokens?: number;
	/**
	 * Sticky-routing session store. When provided (and session stickiness is
	 * enabled), the provider is selected with the normal weighted-score
	 * algorithm and then persisted for the session: subsequent requests reuse
	 * the saved provider so the upstream prompt cache stays warm. The pin only
	 * breaks when the saved provider leaves the available list or its uptime
	 * drops below the session uptime threshold, at which point the session is
	 * re-scored and re-pinned to the new best provider.
	 */
	sessionProviderStore?: SessionProviderStore;
	routingConfig?: ResolvedRoutingConfig;
	organizationId?: string | null;
	providerDiscountResolver?: (
		provider: AvailableModelProvider,
		modelId: string,
	) => Promise<string | null | undefined> | string | null | undefined;
	providerRoutingScoreMultiplierResolver?: (
		provider: AvailableModelProvider,
		modelId: string,
	) => Promise<string | null | undefined> | string | null | undefined;
}

function findProviderMapping<P extends ModelWithPricing["providers"][number]>(
	providers: P[],
	candidate: AvailableModelProvider,
): P | undefined {
	// Identify a mapping by (providerId, region) — externalId is the upstream
	// id and is never used to disambiguate internal lookups.
	return providers.find(
		(p) =>
			p.providerId === candidate.providerId && p.region === candidate.region,
	);
}

export function providerSupportsCaching(
	providerInfo:
		| {
				cachedInputPrice?: string;
				pricingTiers?: ProviderModelMapping["pricingTiers"];
				regions?: ProviderModelMapping["regions"];
		  }
		| undefined,
): boolean {
	if (!providerInfo) {
		return false;
	}
	if (providerInfo.cachedInputPrice !== undefined) {
		return true;
	}
	if (
		providerInfo.pricingTiers?.some(
			(tier) => tier.cachedInputPrice !== undefined,
		)
	) {
		return true;
	}
	if (
		providerInfo.regions?.some(
			(region) =>
				region.cachedInputPrice !== undefined ||
				region.pricingTiers?.some(
					(tier) => tier.cachedInputPrice !== undefined,
				),
		)
	) {
		return true;
	}
	return false;
}

/**
 * Assumptions applied when ranking cache-relevant (large-prompt) requests:
 * `hitRate` blends cachedInputPrice into the input axis, `outputRatio` scales
 * output down from parity to a realistic share of a prompt-heavy request.
 */
export interface CachePricingContext {
	hitRate: number;
	outputRatio: number;
}

export interface VideoPricingContext {
	durationSeconds: number;
	includeAudio: boolean;
	resolution: "default" | "hd" | "1080p" | "4k" | "768p" | "720p" | "480p";
}

function getPerSecondBillingKeys(
	videoPricing: VideoPricingContext,
): Array<keyof NonNullable<ProviderModelMapping["perSecondPrice"]>> {
	if (videoPricing.resolution === "4k") {
		return videoPricing.includeAudio
			? ["4k_audio", "default_audio", "4k", "default"]
			: ["4k_video", "default_video", "4k", "default"];
	}

	if (videoPricing.resolution === "hd") {
		return videoPricing.includeAudio
			? ["hd_audio", "default_audio", "hd", "default"]
			: ["hd_video", "default_video", "hd", "default"];
	}

	if (videoPricing.resolution === "1080p") {
		return videoPricing.includeAudio
			? ["1080p_audio", "hd_audio", "default_audio", "1080p", "hd", "default"]
			: ["1080p_video", "hd_video", "default_video", "1080p", "hd", "default"];
	}

	if (videoPricing.resolution === "768p") {
		return videoPricing.includeAudio
			? ["768p_audio", "default_audio", "768p", "default"]
			: ["768p_video", "default_video", "768p", "default"];
	}

	if (videoPricing.resolution === "720p") {
		return videoPricing.includeAudio
			? ["720p_audio", "768p_audio", "default_audio", "720p", "768p", "default"]
			: [
					"720p_video",
					"768p_video",
					"default_video",
					"720p",
					"768p",
					"default",
				];
	}

	if (videoPricing.resolution === "480p") {
		return videoPricing.includeAudio
			? ["480p_audio", "default_audio", "480p", "default"]
			: ["480p_video", "default_video", "480p", "default"];
	}

	return videoPricing.includeAudio
		? ["default_audio", "default"]
		: ["default_video", "default"];
}

export function getProviderSelectionPrice(
	providerInfo:
		| (Pick<
				ProviderModelMapping,
				| "inputPrice"
				| "outputPrice"
				| "perSecondPrice"
				| "perImagePrice"
				| "requestPrice"
		  > &
				Partial<
					Pick<
						ProviderModelMapping,
						"peakPricing" | "cachedInputPrice" | "pricingTiers"
					>
				>)
		| undefined,
	videoPricing?: VideoPricingContext,
	now: Date = new Date(),
	cachePricing?: CachePricingContext,
	promptTokens?: number,
): Decimal {
	const requestPrice = providerInfo?.requestPrice;
	// Resolve peak/off-peak time-of-day pricing (DeepSeek first-party): token
	// rates vary by UTC hour once the mapping's peakPricing is effective, so
	// routing must rank with the same rates billing uses.
	const timeBasedPricing = providerInfo
		? resolveTimeBasedPricing(providerInfo, now)
		: undefined;
	// Context-length pricing tiers override the base/time-based token rates by
	// prompt size, mirroring billing's getPricingForTokenCount: without this a
	// long-context request would rank a tiered mapping (e.g. xAI over 128K) at
	// its cheaper base rates and select a provider billing then charges more
	// for.
	const pricingTier =
		promptTokens !== undefined && providerInfo?.pricingTiers?.length
			? (providerInfo.pricingTiers.find(
					(tier) => promptTokens <= tier.upToTokens,
				) ?? providerInfo.pricingTiers[providerInfo.pricingTiers.length - 1])
			: undefined;
	const inputPrice =
		pricingTier?.inputPrice ??
		timeBasedPricing?.inputPrice ??
		providerInfo?.inputPrice;
	const outputPrice =
		pricingTier?.outputPrice ??
		timeBasedPricing?.outputPrice ??
		providerInfo?.outputPrice;
	// For cache-relevant requests, rank on the input price a cached workload
	// actually pays: cachedInputPrice weighted by the assumed hit rate. Billing
	// falls back to inputPrice when a mapping declares no cache price, so the
	// same fallback here keeps such mappings ranked exactly as today.
	const cacheHitRate = cachePricing?.hitRate ?? 0;
	const cachedInputPrice =
		pricingTier?.cachedInputPrice ??
		timeBasedPricing?.cachedInputPrice ??
		providerInfo?.cachedInputPrice;
	const effectiveInputPrice =
		cacheHitRate > 0 &&
		inputPrice !== undefined &&
		cachedInputPrice !== undefined
			? new Decimal(cachedInputPrice)
					.times(cacheHitRate)
					.plus(new Decimal(inputPrice).times(1 - cacheHitRate))
			: new Decimal(inputPrice ?? "0");
	// Cache-relevant requests are large-prompt requests, where output is far
	// below parity with input; weighing output at the assumed ratio keeps the
	// cached-input difference from being buried by output list prices.
	const outputRatio = cachePricing?.outputRatio ?? 1;
	const hasAnyTokenPrice =
		inputPrice !== undefined || outputPrice !== undefined;
	const hasPositiveTokenPrice =
		new Decimal(inputPrice ?? "0").gt(0) ||
		new Decimal(outputPrice ?? "0").gt(0);

	if (providerInfo?.perSecondPrice && videoPricing) {
		for (const billingKey of getPerSecondBillingKeys(videoPricing)) {
			const perSecondPrice = providerInfo.perSecondPrice[billingKey];
			if (perSecondPrice !== undefined) {
				return new Decimal(perSecondPrice).times(videoPricing.durationSeconds);
			}
		}
	}

	if (hasPositiveTokenPrice) {
		return effectiveInputPrice
			.plus(new Decimal(outputPrice ?? "0").times(outputRatio))
			.div(2);
	}

	if (providerInfo?.perImagePrice) {
		// Represent the mapping by its cheapest obtainable tier, matching how
		// every other branch (and the gateway's pricingScore) ranks mappings.
		const values = Object.values(providerInfo.perImagePrice).filter(
			(v) => v !== undefined,
		);
		if (values.length > 0) {
			return values.reduce(
				(min, v) => (new Decimal(v).lt(min) ? new Decimal(v) : min),
				new Decimal(values[0]),
			);
		}
	}

	if (requestPrice !== undefined && !hasPositiveTokenPrice) {
		return new Decimal(requestPrice);
	}

	if (hasAnyTokenPrice) {
		return effectiveInputPrice
			.plus(new Decimal(outputPrice ?? "0").times(outputRatio))
			.div(2);
	}

	return new Decimal(0);
}

type ProviderSelectionPriceInfo = AvailableModelProvider &
	Pick<
		ProviderModelMapping,
		| "inputPrice"
		| "outputPrice"
		| "perSecondPrice"
		| "perImagePrice"
		| "requestPrice"
	> &
	Partial<
		Pick<
			ProviderModelMapping,
			"peakPricing" | "cachedInputPrice" | "pricingTiers"
		>
	>;

export async function getDiscountedProviderSelectionPrice(
	providerInfo: ProviderSelectionPriceInfo | undefined,
	modelId: string,
	options?: Pick<
		ProviderSelectionOptions,
		"organizationId" | "providerDiscountResolver" | "promptTokens"
	> & {
		videoPricing?: VideoPricingContext;
		cachePricing?: CachePricingContext;
	},
): Promise<{ price: Decimal; discount: Decimal }> {
	const basePrice = getProviderSelectionPrice(
		providerInfo,
		options?.videoPricing,
		undefined,
		options?.cachePricing,
		options?.promptTokens,
	);
	const discount = providerInfo
		? await getProviderSelectionDiscount(providerInfo, modelId, options)
		: new Decimal(0);

	return {
		price: basePrice.times(new Decimal(1).minus(discount)),
		discount,
	};
}

function providerSelectionKey(provider: AvailableModelProvider): string {
	return `${provider.providerId}:${provider.region ?? ""}`;
}

async function getProviderSelectionDiscount(
	provider: AvailableModelProvider,
	modelId: string,
	options?: ProviderSelectionOptions,
): Promise<Decimal> {
	const discount =
		options?.providerDiscountResolver !== undefined
			? await options.providerDiscountResolver(provider, modelId)
			: options?.organizationId !== undefined
				? (
						await getEffectiveDiscount(
							options.organizationId,
							provider.providerId,
							modelId,
						)
					).discount
				: "0";
	const parsedDiscount = new Decimal(discount ?? "0");

	if (parsedDiscount.lte(0) || parsedDiscount.gt(1)) {
		return new Decimal(0);
	}

	return parsedDiscount;
}

async function getProviderSelectionPrices<T extends AvailableModelProvider>(
	providers: T[],
	modelWithPricing: ModelWithPricing & { id: string },
	videoPricing: VideoPricingContext | undefined,
	options?: ProviderSelectionOptions,
	cachePricing?: CachePricingContext,
): Promise<
	Map<string, { price: Decimal; routingPrice: Decimal; discount: Decimal }>
> {
	const providerPrices = await Promise.all(
		providers.map(async (provider) => {
			const providerInfo = findProviderMapping(
				modelWithPricing.providers,
				provider,
			);
			const metrics = options?.metricsMap?.get(
				metricsKey(modelWithPricing.id, provider.providerId, provider.region),
			);
			const overrides = options?.routingConfig?.cachePricingOverrides;
			const observedCachePricing = cachePricing && {
				hitRate:
					overrides?.cacheHitRate !== undefined || cachePricing.hitRate === 0
						? cachePricing.hitRate
						: (metrics?.cacheHitRate ?? cachePricing.hitRate),
				outputRatio:
					overrides?.cacheOutputRatio !== undefined
						? cachePricing.outputRatio
						: (metrics?.cacheOutputRatio ?? cachePricing.outputRatio),
			};
			const { price, discount } = await getDiscountedProviderSelectionPrice(
				providerInfo,
				modelWithPricing.id,
				{
					...options,
					videoPricing,
					cachePricing: observedCachePricing,
				},
			);
			let routingMultiplier = new Decimal(1);
			if (options?.providerRoutingScoreMultiplierResolver !== undefined) {
				const rawAdjustment =
					await options.providerRoutingScoreMultiplierResolver(
						provider,
						modelWithPricing.id,
					);
				try {
					const scoreAdjustment = new Decimal(rawAdjustment ?? "0");
					if (scoreAdjustment.isFinite() && scoreAdjustment.gte(-1)) {
						routingMultiplier = scoreAdjustment.plus(1);
					}
				} catch {
					// Invalid internal configuration is neutral instead of blocking traffic.
				}
			}

			return [
				providerSelectionKey(provider),
				{
					price,
					routingPrice: price.times(routingMultiplier),
					discount,
				},
			] as const;
		}),
	);

	return new Map(providerPrices);
}

/**
 * Apply sticky-session routing on top of a freshly computed selection.
 *
 * If the session already has a pinned provider that is still available and
 * healthy (uptime at or above the session threshold), reuse it so the upstream
 * prompt cache stays warm. Otherwise persist the just-scored best provider so
 * subsequent requests in this session reuse it. The pin only moves when its
 * provider leaves the candidate list or its uptime drops too low.
 */
async function applySessionSticky<T extends AvailableModelProvider>(
	naturalResult: ProviderSelectionResult<T>,
	candidates: T[],
	store: SessionProviderStore,
	cfg: ResolvedRoutingConfig,
	modelId: string,
	metricsMap: Map<string, ProviderMetrics> | undefined,
): Promise<ProviderSelectionResult<T>> {
	const saved = await store.get();
	if (saved) {
		const candidate = candidates.find(
			(c) =>
				c.providerId === saved.providerId &&
				(saved.region === undefined || c.region === saved.region),
		);
		if (candidate) {
			const uptime = metricsMap?.get(
				metricsKey(modelId, candidate.providerId, candidate.region),
			)?.uptime;
			if (uptime === undefined || uptime >= cfg.session.uptimeThreshold) {
				// Re-persist so the pin's TTL keeps refreshing while the session
				// stays active.
				await store.set(candidate.providerId, candidate.region);
				return {
					provider: candidate,
					metadata: {
						...naturalResult.metadata,
						selectedProvider: candidate.providerId,
						selectionReason: "session-sticky",
					},
				};
			}
		}
	}

	await store.set(
		naturalResult.provider.providerId,
		naturalResult.provider.region,
	);
	return {
		provider: naturalResult.provider,
		metadata: {
			...naturalResult.metadata,
			selectionReason: "session-sticky",
		},
	};
}

/**
 * Get the best provider from a list of available model providers.
 * Considers price, uptime, throughput, and latency metrics.
 *
 * @param availableModelProviders - List of available providers
 * @param modelWithPricing - Model pricing information (must have id property)
 * @param options - Optional settings including metricsMap and isStreaming flag
 * @returns Best provider and routing metadata, or null if none available
 */
export async function getCheapestFromAvailableProviders<
	T extends AvailableModelProvider,
>(
	availableModelProviders: T[],
	modelWithPricing: ModelWithPricing & { id: string; output?: string[] },
	options?: ProviderSelectionOptions,
): Promise<ProviderSelectionResult<T> | null> {
	const metricsMap = options?.metricsMap;
	const isStreaming = options?.isStreaming ?? false;
	const videoPricing = options?.videoPricing;
	const promptTokens = options?.promptTokens;
	const cfg = options?.routingConfig ?? getDefaultRoutingConfig();
	const { thresholds } = cfg;
	const sessionStore = options?.sessionProviderStore;
	const sessionSticky = sessionStore !== undefined && cfg.session.enabled;
	// Use higher price weight for image generation models
	const isImageModel = modelWithPricing.output?.includes("image") ?? false;
	const cacheSupportRelevant =
		(promptTokens !== undefined &&
			promptTokens >= thresholds.cachePromptTokens) ||
		// A new session may start small before growing into the project's usual
		// workload. Use that history before choosing the provider it pins.
		(sessionSticky &&
			availableModelProviders.some(
				(p) =>
					metricsMap?.get(
						metricsKey(modelWithPricing.id, p.providerId, p.region),
					)?.cacheOutputRatio !== undefined,
			));
	const cachePricing: CachePricingContext | undefined = cacheSupportRelevant
		? {
				hitRate: Math.min(1, Math.max(0, thresholds.cacheHitRate)),
				outputRatio: Math.max(0, thresholds.cacheOutputRatio),
			}
		: undefined;
	const scoringFlags = {
		isStreaming,
		isImageModel,
		cacheRelevant: cacheSupportRelevant,
	};
	if (availableModelProviders.length === 0) {
		return null;
	}

	// Filter out unstable and experimental providers, plus providers explicitly
	// disabled via routing override (priority 0).
	const stableProviders = availableModelProviders.filter((provider) => {
		const providerInfo = findProviderMapping(
			modelWithPricing.providers,
			provider,
		);
		const providerStability = providerInfo?.stability;
		const modelStability =
			"stability" in modelWithPricing
				? (modelWithPricing as { stability?: string }).stability
				: undefined;
		const effectiveStability = providerStability ?? modelStability;
		if (
			effectiveStability === "unstable" ||
			effectiveStability === "experimental"
		) {
			return false;
		}
		return getEffectivePriority(provider.providerId, cfg) > 0;
	});

	if (stableProviders.length === 0) {
		return null;
	}

	const providerSelectionPrices = await getProviderSelectionPrices(
		stableProviders,
		modelWithPricing,
		videoPricing,
		options,
		cachePricing,
	);

	// Sticky routing: when a session store is provided (and session stickiness
	// is enabled for the project), the provider is scored with the normal
	// weighted algorithm below and then pinned for the session via the store.
	// Exploration is skipped so the deterministic best is what gets persisted.

	// Epsilon-greedy exploration: randomly select a provider some % of the time
	// (configurable per project via thresholds.explorationRate). Skip during tests
	// to keep behavior deterministic, and for sticky sessions where we want the
	// scored best provider to be the one we pin.
	if (
		!sessionSticky &&
		!isTestProcess() &&
		randomFloat() < getExplorationRate(cfg)
	) {
		const randomProvider =
			stableProviders[randomInt(0, stableProviders.length)];
		return {
			provider: randomProvider,
			metadata: {
				availableProviders: stableProviders.map((p) => p.providerId),
				selectedProvider: randomProvider.providerId,
				selectionReason: "random-exploration",
				providerScores: stableProviders.map((provider) => {
					const providerInfo = findProviderMapping(
						modelWithPricing.providers,
						provider,
					);
					const priority = getEffectivePriority(provider.providerId, cfg);
					const metrics = metricsMap?.get(
						metricsKey(
							modelWithPricing.id,
							provider.providerId,
							provider.region,
						),
					);

					return {
						providerId: provider.providerId,
						region: provider.region,
						score: 0,
						uptime: metrics?.uptime,
						latency: metrics?.averageLatency,
						throughput: metrics?.throughput,
						price: (
							providerSelectionPrices.get(providerSelectionKey(provider))
								?.price ?? getProviderSelectionPrice(providerInfo, videoPricing)
						).toNumber(),
						priority,
						cacheSupported: providerSupportsCaching(
							providerInfo as ProviderModelMapping | undefined,
						),
						discount: providerSelectionPrices
							.get(providerSelectionKey(provider))
							?.discount.toNumber(),
					};
				}),
			},
		};
	}

	// If no metrics provided, fall back to price-only selection
	if (!metricsMap || metricsMap.size === 0) {
		const priceOnlyResult = selectByPriceOnly(
			stableProviders,
			modelWithPricing,
			videoPricing,
			cfg,
			providerSelectionPrices,
		);
		return sessionSticky
			? await applySessionSticky(
					priceOnlyResult,
					stableProviders,
					sessionStore,
					cfg,
					modelWithPricing.id,
					metricsMap,
				)
			: priceOnlyResult;
	}

	// If the project zeroed out every scoring weight, the weighted-score path
	// would divide by zero. Fall back to price-only selection (still honoring
	// per-provider priority overrides and the priority-0 disable).
	const totalWeight = getEffectiveScoringWeights(cfg, scoringFlags).total;
	if (totalWeight <= 0) {
		const priceOnlyResult = selectByPriceOnly(
			stableProviders,
			modelWithPricing,
			videoPricing,
			cfg,
			providerSelectionPrices,
		);
		return sessionSticky
			? await applySessionSticky(
					priceOnlyResult,
					stableProviders,
					sessionStore,
					cfg,
					modelWithPricing.id,
					metricsMap,
				)
			: priceOnlyResult;
	}

	// Calculate scores for each provider
	const providerScores: ProviderScore<T>[] = [];

	for (const provider of stableProviders) {
		const providerInfo = findProviderMapping(
			modelWithPricing.providers,
			provider,
		);
		const resolvedPrice = providerSelectionPrices.get(
			providerSelectionKey(provider),
		);
		const price =
			resolvedPrice?.price ??
			getProviderSelectionPrice(providerInfo, videoPricing);
		const routingPrice = resolvedPrice?.routingPrice ?? price;

		const mKey = metricsKey(
			modelWithPricing.id,
			provider.providerId,
			provider.region,
		);
		const metrics = metricsMap.get(mKey);

		providerScores.push({
			provider,
			score: new Decimal(0), // Will be calculated below
			price,
			routingPrice,
			discount: resolvedPrice?.discount,
			uptime: metrics?.uptime,
			latency: metrics?.averageLatency,
			throughput: metrics?.throughput,
			cacheSupported: providerSupportsCaching(
				providerInfo as ProviderModelMapping | undefined,
			),
		});
	}

	// Score all candidates with the shared weighted-score core (ratio-based
	// sub-scores, priority penalty, exponential uptime penalty — lower wins).
	// totalWeight is guaranteed > 0 above (zero-total falls back to price-only
	// selection earlier in this function).
	const breakdowns = computeWeightedProviderScores(
		providerScores.map((p) => ({
			price: p.routingPrice,
			uptime: p.uptime,
			latency: p.latency,
			throughput: p.throughput,
			cacheSupported: p.cacheSupported ?? false,
			priority: getEffectivePriority(p.provider.providerId, cfg),
		})),
		cfg,
		scoringFlags,
	);
	for (const [index, providerScore] of providerScores.entries()) {
		providerScore.score = breakdowns[index].score;
	}

	// Select provider with lowest score
	let bestProvider = providerScores[0];
	for (const providerScore of providerScores) {
		if (providerScore.score.lt(bestProvider.score)) {
			bestProvider = providerScore;
		}
	}

	// Build routing metadata
	const metadata: RoutingMetadata = {
		availableProviders: providerScores.map((p) => p.provider.providerId),
		selectedProvider: bestProvider.provider.providerId,
		selectionReason: metricsMap ? "weighted-score" : "price-only",
		providerScores: providerScores.map((p) => {
			const priority = getEffectivePriority(p.provider.providerId, cfg);
			return {
				providerId: p.provider.providerId,
				region: p.provider.region,
				score: p.score.toDecimalPlaces(3).toNumber(),
				uptime: p.uptime,
				latency: p.latency,
				throughput: p.throughput,
				price: p.price.toNumber(), // Keep full precision for very small prices
				priority,
				cacheSupported: p.cacheSupported,
				discount: p.discount?.toNumber(),
			};
		}),
	};

	const weightedResult = {
		provider: bestProvider.provider,
		metadata,
	};

	return sessionSticky
		? await applySessionSticky(
				weightedResult,
				stableProviders,
				sessionStore,
				cfg,
				modelWithPricing.id,
				metricsMap,
			)
		: weightedResult;
}

/**
 * Fallback function for price-only selection (original behavior)
 */
function selectByPriceOnly<T extends AvailableModelProvider>(
	stableProviders: T[],
	modelWithPricing: ModelWithPricing & { id: string; output?: string[] },
	videoPricing: VideoPricingContext | undefined,
	cfg: ResolvedRoutingConfig,
	providerSelectionPrices: Map<
		string,
		{ price: Decimal; routingPrice: Decimal; discount: Decimal }
	>,
): ProviderSelectionResult<T> {
	let cheapestProvider = stableProviders[0];
	let lowestEffectivePrice: Decimal | null = null;

	const providerPrices: Array<{
		providerId: string;
		region?: string;
		price: Decimal;
		effectivePrice: Decimal;
		priority: number;
		discount?: Decimal;
	}> = [];

	for (const provider of stableProviders) {
		const providerInfo = findProviderMapping(
			modelWithPricing.providers,
			provider,
		);
		const resolvedPrice = providerSelectionPrices.get(
			providerSelectionKey(provider),
		);
		const totalPrice =
			resolvedPrice?.price ??
			getProviderSelectionPrice(providerInfo, videoPricing);
		const routingPrice = resolvedPrice?.routingPrice ?? totalPrice;

		// Apply provider priority: lower priority = effectively higher price
		const priority = getEffectivePriority(provider.providerId, cfg);
		const effectivePrice =
			priority > 0 ? routingPrice.div(priority) : routingPrice;

		providerPrices.push({
			providerId: provider.providerId,
			region: provider.region,
			price: totalPrice,
			effectivePrice,
			priority,
			discount: resolvedPrice?.discount,
		});

		if (
			lowestEffectivePrice === null ||
			effectivePrice.lt(lowestEffectivePrice)
		) {
			lowestEffectivePrice = effectivePrice;
			cheapestProvider = provider;
		}
	}

	const metadata: RoutingMetadata = {
		availableProviders: stableProviders.map((p) => p.providerId),
		selectedProvider: cheapestProvider.providerId,
		selectionReason: "price-only-no-metrics",
		providerScores: providerPrices.map((p) => ({
			providerId: p.providerId,
			region: p.region,
			score: 0,
			price: p.price.toNumber(),
			priority: p.priority,
			discount: p.discount?.toNumber(),
		})),
	};

	return {
		provider: cheapestProvider,
		metadata,
	};
}
