import { models, type ProviderModelMapping } from "./models.js";
import { providers } from "./providers.js";
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
