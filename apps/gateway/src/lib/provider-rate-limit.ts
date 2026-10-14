import { randomUUID } from "node:crypto";

import { logger } from "@llmgateway/logger";

import { findEffectiveRateLimit } from "./cached-queries.js";
import {
	addTokenWindowEntry,
	addWindowEntry,
	isRateLimitExempt,
	PROVIDER_RATE_LIMIT_WINDOWS,
	providerRateLimitWindows,
	readRequestWindow,
	readTokenWindow,
	TOKEN_WINDOWS,
	type ProviderRateLimitExemption,
	type ProviderRateLimitWindow,
	type ProviderRateLimitWindowState,
} from "./rate-limit-windows.js";

import type {
	EffectiveRateLimit,
	RateLimitMode,
	RateLimitSource,
} from "@llmgateway/db";

export interface ProviderRateLimitResult {
	allowed: boolean;
	rateLimited: boolean;
	blockedBy: ProviderRateLimitWindow[];
	// Every blocking window permits an existing session pin.
	sessionExemptible?: boolean;
	bypassReason?: "session_pin" | "explicit_provider";
	retryAfter?: number;
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>;
}

// Sentinels for shared limits whose matched row left a dimension as a wildcard,
// so every matching request collapses onto one shared counter for that row.
const SHARED_ORG = "__global__";
const ALL_PROVIDERS = "__all_providers__";
const ALL_MODELS = "__all_models__";

function getProviderRateLimitKey(
	organizationId: string,
	provider: string,
	model: string,
	window: ProviderRateLimitWindow,
): string {
	return `rate_limit:provider_cap:${providerRateLimitWindows[window].redisSuffix}:${organizationId}:${provider}:${model}`;
}

/**
 * Build the Redis key for a window. Shared limits key by the matched row's
 * target (collapsing wildcard dimensions onto a sentinel) so a single counter
 * spans all orgs and all requests the row covers; per-org limits key by the
 * org and the concrete request provider/model.
 */
function buildProviderRateLimitKey(
	window: ProviderRateLimitWindow,
	organizationId: string,
	provider: string,
	model: string,
	shared: boolean | undefined,
	matchedProvider: string | null | undefined,
	matchedModel: string | null | undefined,
): string {
	if (!shared) {
		return getProviderRateLimitKey(organizationId, provider, model, window);
	}
	return getProviderRateLimitKey(
		SHARED_ORG,
		matchedProvider ?? ALL_PROVIDERS,
		matchedModel ?? ALL_MODELS,
		window,
	);
}

interface WindowConfig {
	limit: number;
	source: RateLimitSource;
	mode: RateLimitMode;
	shared?: boolean;
	provider?: string | null;
	model?: string | null;
}

function getWindowConfig(
	effective: EffectiveRateLimit,
	window: ProviderRateLimitWindow,
): WindowConfig {
	switch (window) {
		case "rpm":
			return {
				limit: effective.maxRpm,
				source: effective.rpmSource,
				mode: effective.rpmMode ?? "strict",
				shared: effective.rpmShared,
				provider: effective.rpmProvider,
				model: effective.rpmModel,
			};
		case "rpd":
			return {
				limit: effective.maxRpd,
				source: effective.rpdSource,
				mode: effective.rpdMode ?? "strict",
				shared: effective.rpdShared,
				provider: effective.rpdProvider,
				model: effective.rpdModel,
			};
		case "tpm":
			return {
				limit: effective.maxTpm ?? 0,
				source: effective.tpmSource ?? "none",
				mode: effective.tpmMode ?? "strict",
				shared: effective.tpmShared,
				provider: effective.tpmProvider,
				model: effective.tpmModel,
			};
		case "tpd":
			return {
				limit: effective.maxTpd ?? 0,
				source: effective.tpdSource ?? "none",
				mode: effective.tpdMode ?? "strict",
				shared: effective.tpdShared,
				provider: effective.tpdProvider,
				model: effective.tpdModel,
			};
	}
}

async function readWindowState(
	key: string,
	window: ProviderRateLimitWindow,
	limit: number,
	now: number,
	source: RateLimitSource,
	mode: RateLimitMode,
): Promise<ProviderRateLimitWindowState> {
	// Carrier zero means unlimited; an admin zero cap is already exhausted.
	if (
		limit === 0 &&
		(source === "none" || source === "carrier_provider_model")
	) {
		return {
			currentCount: 0,
			limit: 0,
			remaining: 0,
			rateLimited: false,
			source,
			mode,
		};
	}

	return providerRateLimitWindows[window].unit === "tokens"
		? await readTokenWindow(key, window, limit, now, source, mode)
		: await readRequestWindow(key, window, limit, now, source, mode);
}

function getCombinedRetryAfter(
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>,
	blockedBy: ProviderRateLimitWindow[],
): number | undefined {
	if (blockedBy.length === 0) {
		return undefined;
	}

	return blockedBy.reduce<number | undefined>((maxRetryAfter, window) => {
		const retryAfter = limits[window].retryAfter;
		if (retryAfter === undefined) {
			return maxRetryAfter;
		}
		return maxRetryAfter === undefined
			? retryAfter
			: Math.max(maxRetryAfter, retryAfter);
	}, undefined);
}

function buildUnlimitedLimits(): Record<
	ProviderRateLimitWindow,
	ProviderRateLimitWindowState
> {
	const unlimited: ProviderRateLimitWindowState = {
		currentCount: 0,
		limit: 0,
		remaining: 0,
		rateLimited: false,
		source: "none",
		mode: "strict",
	};
	return {
		rpm: { ...unlimited },
		rpd: { ...unlimited },
		tpm: { ...unlimited },
		tpd: { ...unlimited },
	};
}

function buildFallbackResult(): ProviderRateLimitResult {
	return {
		allowed: true,
		rateLimited: false,
		blockedBy: [],
		limits: buildUnlimitedLimits(),
	};
}

function buildWindowKey(
	window: ProviderRateLimitWindow,
	organizationId: string,
	provider: string,
	model: string,
	config: WindowConfig,
): string {
	return buildProviderRateLimitKey(
		window,
		organizationId,
		provider,
		model,
		config.shared,
		config.provider,
		config.model,
	);
}

async function getProviderRateLimitStates(
	organizationId: string,
	provider: string,
	model: string,
): Promise<{
	keys: Record<ProviderRateLimitWindow, string>;
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>;
}> {
	const effectiveRateLimit = await findEffectiveRateLimit(
		organizationId,
		provider,
		model,
	);
	const now = Date.now();

	const keys = {} as Record<ProviderRateLimitWindow, string>;
	const limits = buildUnlimitedLimits();
	for (const window of PROVIDER_RATE_LIMIT_WINDOWS) {
		const config = getWindowConfig(effectiveRateLimit, window);
		keys[window] = buildWindowKey(
			window,
			organizationId,
			provider,
			model,
			config,
		);
		limits[window] = await readWindowState(
			keys[window],
			window,
			config.limit,
			now,
			config.source,
			config.mode,
		);
	}

	return { keys, limits };
}

function getBlockedWindows(
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>,
): ProviderRateLimitWindow[] {
	return (
		Object.entries(limits) as Array<
			[ProviderRateLimitWindow, ProviderRateLimitWindowState]
		>
	)
		.filter(([, limit]) => limit.rateLimited)
		.map(([window]) => window);
}

function isSessionExemptible(
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>,
	blockedBy: ProviderRateLimitWindow[],
): boolean {
	return (
		getProviderRateLimitBypassReason(
			{ limits, blockedBy },
			{ sessionPinned: true },
		) !== undefined
	);
}

export type { ProviderRateLimitExemption };

export function getProviderRateLimitBypassReason(
	result: Pick<ProviderRateLimitResult, "limits" | "blockedBy">,
	options: ProviderRateLimitExemption,
): ProviderRateLimitResult["bypassReason"] {
	if (result.blockedBy.length === 0) {
		return undefined;
	}
	const allowed = result.blockedBy.every((window) =>
		isRateLimitExempt(result.limits[window].mode, options),
	);
	return allowed
		? options.sessionPinned
			? "session_pin"
			: "explicit_provider"
		: undefined;
}

export function mustEnforceProviderRateLimit(
	result: Pick<ProviderRateLimitResult, "limits" | "blockedBy">,
): boolean {
	return result.blockedBy.some(
		(window) =>
			result.limits[window].mode === "lax" || result.limits[window].limit === 0,
	);
}

export function getExceededProviderRateLimitLabels(
	blockedBy: ProviderRateLimitWindow[],
): string {
	return blockedBy
		.map((window) => providerRateLimitWindows[window].headerSuffix)
		.join(" and ");
}

/**
 * Read-only check of provider/model caps — does NOT consume a slot.
 * Used during routing to filter out rate-limited providers.
 */
export async function peekProviderRateLimit(
	organizationId: string,
	provider: string,
	model: string,
): Promise<ProviderRateLimitResult> {
	try {
		const { limits } = await getProviderRateLimitStates(
			organizationId,
			provider,
			model,
		);
		const blockedBy = getBlockedWindows(limits);

		return {
			allowed: blockedBy.length === 0,
			rateLimited: blockedBy.length > 0,
			blockedBy,
			sessionExemptible: isSessionExemptible(limits, blockedBy),
			retryAfter: getCombinedRetryAfter(limits, blockedBy),
			limits,
		};
	} catch (error) {
		logger.error("Error peeking provider rate limit:", error as Error);
		return buildFallbackResult();
	}
}

/**
 * Batch check which providers are rate-limited (read-only, no slot consumed).
 * `sessionExemptible` permits session pins; `enforcedLimits` must never fail open.
 */
export async function filterRateLimitedProviders(
	organizationId: string,
	candidates: Array<{
		providerId: string;
		model: string;
	}>,
): Promise<{
	rateLimited: Set<string>;
	sessionExemptible: Set<string>;
	enforcedLimits: Map<string, ProviderRateLimitResult>;
}> {
	const results = await Promise.all(
		candidates.map(async (candidate) => ({
			providerId: candidate.providerId,
			...(await peekProviderRateLimit(
				organizationId,
				candidate.providerId,
				candidate.model,
			)),
		})),
	);

	const limited = results.filter((result) => result.rateLimited);
	return {
		rateLimited: new Set(limited.map((result) => result.providerId)),
		enforcedLimits: new Map(
			limited
				.filter(mustEnforceProviderRateLimit)
				.map((result) => [result.providerId, result]),
		),
		sessionExemptible: new Set(
			limited
				.filter((result) => result.sessionExemptible)
				.map((result) => result.providerId),
		),
	};
}

/**
 * Pick fallback candidates that are not at a request or token cap.
 * Dedupes peeks by providerId since rate limits are keyed by org+provider+root
 * model id, so region-expanded variants share the same window. Falls open to
 * original candidates if every one is capped, except exhausted lax or zero caps.
 */
export async function pickNonRateLimitedCandidates<
	T extends { providerId: string },
>(organizationId: string, baseModelId: string, candidates: T[]): Promise<T[]> {
	if (candidates.length === 0) {
		return candidates;
	}

	const uniquePeekCandidates = Array.from(
		new Map(
			candidates.map((p) => [
				p.providerId,
				{
					providerId: p.providerId,
					model: baseModelId,
				},
			]),
		).values(),
	);

	const { rateLimited, enforcedLimits } = await filterRateLimitedProviders(
		organizationId,
		uniquePeekCandidates,
	);

	const nonRateLimited = candidates.filter(
		(p) => !rateLimited.has(p.providerId),
	);

	return nonRateLimited.length > 0
		? nonRateLimited
		: candidates.filter((p) => !enforcedLimits.has(p.providerId));
}

/**
 * Check configurable provider/model caps stored in the database.
 * Uses a Redis sliding window approach identical to free model rate limiting.
 * Exempt requests still count toward every configured window.
 */
export async function checkProviderRateLimit(
	organizationId: string,
	provider: string,
	model: string,
	options: ProviderRateLimitExemption = {},
): Promise<ProviderRateLimitResult> {
	try {
		const { keys, limits } = await getProviderRateLimitStates(
			organizationId,
			provider,
			model,
		);
		const blockedBy = getBlockedWindows(limits);

		const sessionExemptible = isSessionExemptible(limits, blockedBy);
		const bypassReason = getProviderRateLimitBypassReason(
			{ limits, blockedBy },
			options,
		);

		if (blockedBy.length > 0 && !bypassReason) {
			const retryAfter = getCombinedRetryAfter(limits, blockedBy);

			logger.info(`Provider rate limit exceeded`, {
				organizationId,
				provider,
				model,
				blockedBy,
				limits,
				retryAfter,
			});

			return {
				allowed: false,
				rateLimited: true,
				blockedBy,
				sessionExemptible,
				retryAfter,
				limits,
			};
		}

		const now = Date.now();
		const member = `${now}:${randomUUID()}`;
		const configuredWindows = (
			Object.entries(limits) as Array<
				[ProviderRateLimitWindow, ProviderRateLimitWindowState]
			>
		).filter(
			([window, limit]) =>
				providerRateLimitWindows[window].unit === "requests" &&
				(limit.limit > 0 || limit.rateLimited),
		);

		await Promise.all(
			configuredWindows.map(([window]) =>
				addWindowEntry(keys[window], window, now, member),
			),
		);

		const updatedLimits = configuredWindows.reduce(
			(acc, [window, limit]) => {
				acc[window] = {
					...limit,
					currentCount: limit.currentCount + 1,
					remaining: Math.max(0, limit.limit - limit.currentCount - 1),
				};
				return acc;
			},
			{ ...limits },
		);

		logger.debug(`Provider rate limit check passed`, {
			organizationId,
			provider,
			model,
			limits: updatedLimits,
		});

		return {
			allowed: true,
			rateLimited: false,
			blockedBy: [],
			...(bypassReason && { bypassReason }),
			limits: updatedLimits,
		};
	} catch (error) {
		logger.error("Error checking provider rate limit:", error as Error);
		return buildFallbackResult();
	}
}

/**
 * Add a logged request's prompt + completion tokens to the token windows of
 * the provider/model caps that apply to it. Token caps are post-paid: the
 * request that crosses a cap completes, and later ones are rejected until the
 * window slides. Swallows its own errors so logging is never blocked.
 */
export async function recordProviderTokenUsage(
	organizationId: string,
	provider: string,
	model: string,
	tokens: number,
): Promise<void> {
	if (!(tokens > 0)) {
		return;
	}
	try {
		const effectiveRateLimit = await findEffectiveRateLimit(
			organizationId,
			provider,
			model,
		);
		const now = Date.now();
		await Promise.all(
			TOKEN_WINDOWS.map(async (window) => {
				const config = getWindowConfig(effectiveRateLimit, window);
				if (config.limit <= 0) {
					return;
				}
				await addTokenWindowEntry(
					buildWindowKey(window, organizationId, provider, model, config),
					window,
					now,
					tokens,
				);
			}),
		);
	} catch (error) {
		logger.error("Error recording provider token usage:", error as Error);
	}
}
