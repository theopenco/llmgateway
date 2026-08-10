import {
	hasProviderEnvironmentToken,
	type Provider,
	providers,
} from "@llmgateway/models";

import type { ManagedProviderAvailability } from "@/lib/cached-queries.js";

export type ProjectMode = "api-keys" | "credits" | "hybrid";

/** A deployment with no managed credentials at all: every provider reads its env vars. */
export const EMPTY_MANAGED_PROVIDER_AVAILABILITY: ManagedProviderAvailability =
	{
		configured: new Set(),
		usable: new Set(),
		defaultRegionUsable: new Set(),
		pinnedRegions: new Map(),
	};

/**
 * Whether the provider's `LLM_*` environment variables still count for
 * routing. Managed credentials replace them rather than complement them: a
 * provider configured on the admin dashboard is served only by those
 * credentials, so its environment is ignored for routing and every fallback.
 */
export function environmentServesProvider(
	providerId: string,
	managed: ManagedProviderAvailability = EMPTY_MANAGED_PROVIDER_AVAILABILITY,
): boolean {
	return (
		!managed.configured.has(providerId) &&
		hasProviderEnvironmentToken(providerId as Provider)
	);
}

/**
 * Whether the platform holds a credential that can serve the provider in this
 * region — a managed credential pinned to it (or a region-agnostic one, which
 * `usable` already reports), or the provider's regional env var when no managed
 * credential supersedes the environment.
 */
export function platformCredentialCoversRegion(
	providerId: string,
	region: string,
	managed: ManagedProviderAvailability,
	hasRegionalEnvKey: () => boolean,
): boolean {
	if (managed.configured.has(providerId)) {
		return (
			managed.usable.has(providerId) ||
			Boolean(managed.pinnedRegions.get(providerId)?.has(region))
		);
	}
	return hasRegionalEnvKey();
}

/**
 * Whether the platform can serve the provider before a region is known. Such a
 * request is sent to the provider's default region, so a credential pinned to
 * that region serves it just as a region-agnostic one does — the only shape
 * available for a provider with no global region, whose every credential is
 * necessarily region-pinned (Alibaba). Providers whose credential is shared
 * across regions (AWS Bedrock) are excluded from `defaultRegionUsable`, so for
 * them this stays exactly `usable`.
 */
export function platformCredentialServesDefaultRegion(
	providerId: string,
	managed: ManagedProviderAvailability,
): boolean {
	return (
		managed.usable.has(providerId) ||
		managed.defaultRegionUsable.has(providerId)
	);
}

/**
 * Providers LLM Gateway can serve itself, i.e. the ones it holds a credential
 * for. A credential is either a managed provider-key row (the database-backed
 * configuration) or the provider's `LLM_*` environment variable — and once the
 * provider has any managed credential the environment no longer counts, so a
 * provider whose managed credentials cannot serve this request is dropped
 * rather than silently served by the env var they superseded.
 */
export function getPlatformBackedProviders(
	managed: ManagedProviderAvailability = EMPTY_MANAGED_PROVIDER_AVAILABILITY,
	providerIds?: string[],
): string[] {
	const candidateProviders = providerIds
		? providers.filter((provider) => providerIds.includes(provider.id))
		: providers;

	return candidateProviders
		.filter((provider) => provider.id !== "llmgateway")
		.filter(
			(provider) =>
				platformCredentialServesDefaultRegion(provider.id, managed) ||
				environmentServesProvider(provider.id, managed),
		)
		.map((provider) => provider.id);
}

export function getAvailableProvidersForProjectMode(
	projectMode: ProjectMode,
	providerKeys: Array<{ provider: string }>,
	providerIds?: string[],
	managed?: ManagedProviderAvailability,
): {
	availableProviders: string[];
	providersWithKeys: Set<string>;
} {
	const providersWithKeys = new Set(providerKeys.map((key) => key.provider));

	if (projectMode === "api-keys") {
		return {
			availableProviders: Array.from(providersWithKeys),
			providersWithKeys,
		};
	}

	const platformProviders = getPlatformBackedProviders(managed, providerIds);

	if (projectMode === "credits") {
		return {
			availableProviders: platformProviders,
			providersWithKeys,
		};
	}

	return {
		availableProviders: Array.from(
			new Set([...providersWithKeys, ...platformProviders]),
		),
		providersWithKeys,
	};
}

export function preferProvidersWithKeys<T extends { providerId: string }>(
	projectMode: ProjectMode,
	candidates: T[],
	providersWithKeys: Set<string>,
): T[] {
	if (projectMode !== "hybrid") {
		return candidates;
	}

	const keyedCandidates = candidates.filter((candidate) =>
		providersWithKeys.has(candidate.providerId),
	);

	return keyedCandidates.length > 0 ? keyedCandidates : candidates;
}

export function getRoutingCandidatesForProjectMode<
	T extends { providerId: string },
>(
	projectMode: ProjectMode,
	candidates: T[],
	rateLimitedProviderIds: Set<string>,
	providersWithKeys: Set<string>,
): T[] {
	const nonRateLimitedCandidates = candidates.filter(
		(candidate) => !rateLimitedProviderIds.has(candidate.providerId),
	);

	if (projectMode !== "hybrid") {
		return nonRateLimitedCandidates.length > 0
			? nonRateLimitedCandidates
			: candidates;
	}

	const keyedCandidates = candidates.filter((candidate) =>
		providersWithKeys.has(candidate.providerId),
	);

	if (keyedCandidates.length === 0) {
		return nonRateLimitedCandidates.length > 0
			? nonRateLimitedCandidates
			: candidates;
	}

	const nonRateLimitedKeyedCandidates = keyedCandidates.filter(
		(candidate) => !rateLimitedProviderIds.has(candidate.providerId),
	);

	if (nonRateLimitedKeyedCandidates.length > 0) {
		return nonRateLimitedKeyedCandidates;
	}

	if (nonRateLimitedCandidates.length > 0) {
		return nonRateLimitedCandidates;
	}

	return keyedCandidates;
}
