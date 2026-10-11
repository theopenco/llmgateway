/**
 * Provider/model access restriction LLM Gateway staff set on an organization
 * from the admin dashboard. Unlike the customer-managed provider compliance
 * policy, the organization cannot change it.
 * No restriction (null) allows everything.
 */
export interface ProviderAccessRestriction {
	/**
	 * `deny`: a provider mapping matching any entry is blocked.
	 * `allow`: only provider mappings matching at least one entry are served.
	 */
	mode: ProviderAccessRestrictionMode;
	/** Catalogue provider ids, e.g. "openai". */
	providers: string[];
	/** Catalogue model ids, matched on every provider serving the model. */
	models: string[];
	/** Single provider mappings as `<providerId>/<modelId>` refs. */
	mappings: string[];
	/** Why the restriction exists; recorded in the organization's audit log. */
	note?: string;
}

export const PROVIDER_ACCESS_RESTRICTION_MODES = ["allow", "deny"] as const;

export type ProviderAccessRestrictionMode =
	(typeof PROVIDER_ACCESS_RESTRICTION_MODES)[number];

/**
 * Routing pseudo-models served by the "llmgateway" provider. They resolve to a
 * real model whose mappings are checked on their own, so the restriction never
 * applies to the pseudo-model itself.
 */
const ROUTING_PSEUDO_MODELS: readonly string[] = ["auto", "smart"];

export function providerAccessMappingRef(
	providerId: string,
	modelId: string,
): string {
	return `${providerId}/${modelId}`;
}

/** Splits a mapping ref at the first "/" (model ids may contain slashes). */
export function parseProviderAccessMappingRef(
	ref: string,
): { providerId: string; modelId: string } | undefined {
	const index = ref.indexOf("/");
	if (index <= 0 || index === ref.length - 1) {
		return undefined;
	}
	return { providerId: ref.slice(0, index), modelId: ref.slice(index + 1) };
}

/** Whether a restriction has no entries (a no-op deny list or a block-all allow list). */
export function isProviderAccessRestrictionEmpty(
	restriction: ProviderAccessRestriction,
): boolean {
	return (
		restriction.providers.length === 0 &&
		restriction.models.length === 0 &&
		restriction.mappings.length === 0
	);
}

/**
 * Whether the restriction lets the organization use `modelId` through
 * `providerId`. Entries of all three kinds are unioned: in deny mode any match
 * blocks, in allow mode any match permits.
 */
export function isProviderMappingAllowedByRestriction(
	restriction: ProviderAccessRestriction | null | undefined,
	providerId: string,
	modelId: string,
): boolean {
	if (!restriction) {
		return true;
	}
	if (providerId === "llmgateway" && ROUTING_PSEUDO_MODELS.includes(modelId)) {
		return true;
	}
	const matches =
		restriction.providers.includes(providerId) ||
		restriction.models.includes(modelId) ||
		restriction.mappings.includes(
			providerAccessMappingRef(providerId, modelId),
		);
	return restriction.mode === "deny" ? !matches : matches;
}
