import {
	hasProviderEnvironmentToken,
	type Provider,
	providers,
} from "@llmgateway/models";

export type ProjectMode = "api-keys" | "credits" | "hybrid";

export function getEnvironmentBackedProviders(
	providerIds?: string[],
): string[] {
	const candidateProviders = providerIds
		? providers.filter((provider) => providerIds.includes(provider.id))
		: providers;

	return candidateProviders
		.filter((provider) => provider.id !== "llmgateway")
		.filter((provider) => hasProviderEnvironmentToken(provider.id as Provider))
		.map((provider) => provider.id);
}

export function getAvailableProvidersForProjectMode(
	projectMode: ProjectMode,
	providerKeys: Array<{ provider: string }>,
	providerIds?: string[],
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

	const envProviders = getEnvironmentBackedProviders(providerIds);

	if (projectMode === "credits") {
		return {
			availableProviders: envProviders,
			providersWithKeys,
		};
	}

	return {
		availableProviders: Array.from(
			new Set([...providersWithKeys, ...envProviders]),
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
