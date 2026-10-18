import { models, type ProviderModelMapping } from "./models.js";
import { expandAllProviderRegions } from "./region-helpers.js";

/**
 * Requests that don't name a provider only route to deployments whose context
 * window is within this fraction of the model's reference window. Smaller
 * deployments stay reachable by pinning them (`provider/model`).
 */
export const CONTEXT_TIER_TOLERANCE = 0.1;

/**
 * Fewest distinct providers that must serve the full window before smaller
 * deployments are excluded. One is enough: a model served at its full window
 * anywhere must not route long conversations to a smaller deployment.
 */
export const CONTEXT_TIER_MIN_PROVIDERS = 1;

type ContextSizedMapping = Pick<
	ProviderModelMapping,
	"providerId" | "contextSize" | "deactivatedAt" | "regions"
>;

function isActive(mapping: ContextSizedMapping, now: Date): boolean {
	return !mapping.deactivatedAt || new Date(mapping.deactivatedAt) > now;
}

function largestContextSize(
	mappings: readonly ContextSizedMapping[],
	now: Date,
): number | undefined {
	let largest: number | undefined;
	for (const mapping of expandAllProviderRegions(
		mappings as ProviderModelMapping[],
	)) {
		if (
			isActive(mapping, now) &&
			mapping.contextSize !== undefined &&
			mapping.contextSize > (largest ?? 0)
		) {
			largest = mapping.contextSize;
		}
	}
	return largest;
}

function findCatalogueModel(modelId: string) {
	return models.find(
		(model) =>
			model.id === modelId ||
			("aliases" in model &&
				(model.aliases as readonly string[] | undefined)?.includes(modelId)),
	);
}

/**
 * The model's reference context window: the largest among its active catalogue
 * deployments. Airside listings are self-reported, so they only set it for
 * models the catalogue has no context size for (`fallbackMappings`).
 */
export function getReferenceContextSize(
	modelId: string,
	fallbackMappings: readonly ContextSizedMapping[] = [],
	now: Date = new Date(),
): number | undefined {
	const catalogueModel = findCatalogueModel(modelId);
	const fromCatalogue = catalogueModel
		? largestContextSize(catalogueModel.providers, now)
		: undefined;
	return fromCatalogue ?? largestContextSize(fallbackMappings, now);
}

/**
 * Smallest context window a deployment needs to serve requests for the model
 * that don't name a provider, or undefined when the rule does not apply: no
 * known reference window, or fewer than `CONTEXT_TIER_MIN_PROVIDERS` providers
 * serve it.
 */
export function getContextTierMinSize(
	modelId: string,
	mappings: readonly ContextSizedMapping[],
	now: Date = new Date(),
): number | undefined {
	const reference = getReferenceContextSize(modelId, mappings, now);
	if (reference === undefined) {
		return undefined;
	}
	const minSize = reference * (1 - CONTEXT_TIER_TOLERANCE);
	const tierProviders = new Set(
		expandAllProviderRegions(mappings as ProviderModelMapping[])
			.filter(
				(mapping) =>
					isActive(mapping, now) &&
					mapping.contextSize !== undefined &&
					mapping.contextSize >= minSize,
			)
			.map((mapping) => mapping.providerId),
	);
	return tierProviders.size >= CONTEXT_TIER_MIN_PROVIDERS ? minSize : undefined;
}

export type ContextSizeDeviation = "below" | "above";

/**
 * How a deployment's context window compares with the model's reference
 * window. "below" deployments are left out of routing for requests that don't
 * name a provider; "above" claims exceed every catalogue deployment and need
 * checking.
 */
export function getContextSizeDeviation(
	contextSize: number | null | undefined,
	referenceContextSize: number | null | undefined,
): ContextSizeDeviation | undefined {
	if (!contextSize || !referenceContextSize) {
		return undefined;
	}
	if (contextSize < referenceContextSize * (1 - CONTEXT_TIER_TOLERANCE)) {
		return "below";
	}
	if (contextSize > referenceContextSize * (1 + CONTEXT_TIER_TOLERANCE)) {
		return "above";
	}
	return undefined;
}
