import { models, type ProviderModelMapping } from "./models.js";
import { providers, type ServiceTier } from "./providers.js";
import { expandAllProviderRegions } from "./region-helpers.js";

/**
 * Check if a specific model and provider combination supports streaming.
 * When a region is specified, checks the expanded regional mapping.
 */
export function getModelStreamingSupport(
	modelName: string,
	providerId?: string,
	region?: string,
): boolean | "only" | null {
	// When a provider is specified, prefer the model definition that includes it
	const modelInfo = providerId
		? (models.find(
				(m) =>
					m.id === modelName &&
					m.providers.some((p) => p.providerId === providerId),
			) ?? models.find((m) => m.id === modelName))
		: models.find((m) => m.id === modelName);
	if (!modelInfo) {
		return null;
	}

	// Expand regions so we can match region-specific streaming overrides
	const expanded = expandAllProviderRegions(modelInfo.providers);

	// If no specific provider is requested, check if any provider for this model supports streaming
	if (!providerId) {
		return expanded.some((provider: ProviderModelMapping) => {
			// Check model-level streaming first, then fall back to provider-level
			if (provider.streaming !== undefined) {
				return provider.streaming;
			}
			// Fall back to provider-level streaming support
			const providerInfo = providers.find((p) => p.id === provider.providerId);
			return providerInfo?.streaming === true;
		});
	}

	// Check specific provider (and region) for this model
	const providerMapping = expanded.find(
		(p) =>
			p.providerId === providerId && (region ? p.region === region : !p.region),
	);
	if (!providerMapping) {
		// Fall back to root mapping without region
		const rootMapping = expanded.find(
			(p) => p.providerId === providerId && !p.region,
		);
		if (!rootMapping) {
			return false;
		}
		if (rootMapping.streaming !== undefined) {
			return rootMapping.streaming;
		}
		const providerInfo = providers.find((p) => p.id === providerId);
		return providerInfo?.streaming === true;
	}

	// Check model-level streaming first, then fall back to provider-level
	if (providerMapping.streaming !== undefined) {
		return providerMapping.streaming;
	}

	// Fall back to provider-level streaming support
	const providerInfo = providers.find((p) => p.id === providerId);
	return providerInfo?.streaming === true;
}

function getProviderMappingForModel(
	modelName: string,
	providerId: string,
	region?: string | null,
): ProviderModelMapping | undefined {
	const modelInfo = models.find((m) => m.id === modelName);
	if (!modelInfo) {
		return undefined;
	}

	const expandedProviders = expandAllProviderRegions(
		modelInfo.providers as ProviderModelMapping[],
	);
	const providerEntries = expandedProviders.filter(
		(p) => p.providerId === providerId,
	);
	const isBaseEntry = (p: ProviderModelMapping) =>
		p.region === undefined || p.region === null;
	const hasRegionalEntries = providerEntries.some((p) => !isBaseEntry(p));

	if (region !== null && region !== undefined) {
		const regionalEntry = providerEntries.find((p) => p.region === region);
		if (regionalEntry) {
			return regionalEntry;
		}
		if (!hasRegionalEntries) {
			return providerEntries.find(isBaseEntry);
		}
		return undefined;
	}

	return providerEntries.find(isBaseEntry) ?? providerEntries[0];
}

export function getSupportedServiceTiers(
	modelName: string,
	providerId: string,
	region?: string | null,
): ServiceTier[] {
	const providerDefinition = providers.find((p) => p.id === providerId);
	const providerTiers = providerDefinition?.serviceTiers ?? [];
	if (providerTiers.length === 0) {
		return [];
	}

	const providerMapping = getProviderMappingForModel(
		modelName,
		providerId,
		region,
	);
	const supportedTierIds = providerMapping?.serviceTiers;
	if (!supportedTierIds || supportedTierIds.length === 0) {
		return [];
	}

	const serviceTierRegions = providerMapping.serviceTierRegions;
	if (serviceTierRegions && serviceTierRegions.length > 0) {
		const effectiveRegion =
			region ?? (serviceTierRegions.includes("global") ? "global" : undefined);
		if (!effectiveRegion || !serviceTierRegions.includes(effectiveRegion)) {
			return [];
		}
	}

	const supportedTierIdSet = new Set(supportedTierIds);
	return providerTiers
		.filter((tier) => supportedTierIdSet.has(tier.id))
		.map((tier) => ({
			...tier,
			multiplier:
				providerMapping.serviceTierMultipliers?.[tier.id] ?? tier.multiplier,
		}));
}

export function supportsServiceTier(
	modelName: string,
	providerId: string,
	tierId: string | null | undefined,
	region?: string | null,
): boolean {
	if (!tierId) {
		return false;
	}
	return getSupportedServiceTiers(modelName, providerId, region).some(
		(tier) => tier.id === tierId,
	);
}

// OpenAI prompt_cache_retention="24h" eligibility per
// https://developers.openai.com/api/docs/guides/prompt-caching.
// gpt-5.5 and gpt-5.5-pro default to 24h and reject "in_memory"; the rest
// accept either. Models not on this list only support "in_memory" caching.
const OPENAI_EXTENDED_PROMPT_CACHE_MODELS = new Set<string>([
	"gpt-5.5",
	"gpt-5.5-pro",
	"gpt-5.4",
	"gpt-5.2",
	"gpt-5.1-codex-max",
	"gpt-5.1",
	"gpt-5.1-codex",
	"gpt-5.1-codex-mini",
	"gpt-5.1-chat-latest",
	"gpt-5",
	"gpt-5-codex",
	"gpt-4.1",
]);

export function supportsOpenAIExtendedPromptCache(modelName: string): boolean {
	return OPENAI_EXTENDED_PROMPT_CACHE_MODELS.has(modelName);
}
