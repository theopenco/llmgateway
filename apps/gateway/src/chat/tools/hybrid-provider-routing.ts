import {
	hasProviderEnvironmentToken,
	type Provider,
	providers,
} from "@llmgateway/models";

export type ProjectMode = "api-keys" | "credits" | "hybrid";

/**
 * Providers LLM Gateway can serve itself, i.e. the ones it holds a credential
 * for. A credential is either a managed provider-key row (the database-backed
 * configuration) or the provider's `LLM_*` environment variable, so a provider
 * migrated into the database stays routable once its env var is removed.
 */
export function getPlatformBackedProviders(
	managedProviderIds: ReadonlySet<string> = new Set(),
	providerIds?: string[],
): string[] {
	const candidateProviders = providerIds
		? providers.filter((provider) => providerIds.includes(provider.id))
		: providers;

	return candidateProviders
		.filter((provider) => provider.id !== "llmgateway")
		.filter(
			(provider) =>
				managedProviderIds.has(provider.id) ||
				hasProviderEnvironmentToken(provider.id as Provider),
		)
		.map((provider) => provider.id);
}

export function getAvailableProvidersForProjectMode(
	projectMode: ProjectMode,
	providerKeys: Array<{ provider: string }>,
	providerIds?: string[],
	managedProviderIds?: ReadonlySet<string>,
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

	const platformProviders = getPlatformBackedProviders(
		managedProviderIds,
		providerIds,
	);

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
