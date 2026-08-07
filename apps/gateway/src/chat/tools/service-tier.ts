import { HTTPException } from "hono/http-exception";

import {
	isPremiumServiceTier,
	providerCredentialSupportsServiceTier,
} from "@llmgateway/actions";
import {
	type EnvVarVariant,
	getProviderEnvValue,
	type Provider,
	type ProviderModelMapping,
	supportsServiceTier,
} from "@llmgateway/models";

import type { InferSelectModel, tables } from "@llmgateway/db";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

/**
 * The region a service-tier decision must be evaluated against for a resolved
 * attempt. Google Vertex mappings carry no region of their own — the endpoint's
 * location comes from the credential (`LLM_GOOGLE_VERTEX_REGION` for the env
 * path, `config.region` / `options.env_config.region` for a database-backed
 * credential) — so the effective region has to be read from there. Every other
 * provider uses the mapping's own region.
 */
export function resolveServiceTierRegion(
	provider: Provider,
	region: string | undefined,
	configIndex?: number,
	variant?: EnvVarVariant,
): string | undefined {
	if (provider !== "google-vertex") {
		return region;
	}
	return (
		region ??
		getProviderEnvValue(
			"google-vertex",
			"region",
			configIndex,
			"global",
			variant,
		) ??
		"global"
	);
}

/**
 * The tier to actually forward upstream for a resolved (model, provider,
 * region, credential) attempt. Returns undefined when no premium tier was
 * requested, or when the resolved mapping cannot serve the requested one.
 *
 * Callers must never treat an undefined result for a premium request as
 * "send at standard": routing is pre-filtered to tier-capable mappings and
 * credentials, so undefined means the attempt would be silently downgraded —
 * see `assertServiceTierHonored`.
 */
export function getForwardedServiceTier(
	model: string,
	provider: Provider,
	region: string | undefined,
	serviceTier: "auto" | "default" | "flex" | "priority" | undefined,
	configIndex?: number,
	variant?: EnvVarVariant,
): "flex" | "priority" | undefined {
	if (!isPremiumServiceTier(serviceTier)) {
		return undefined;
	}
	const effectiveRegion = resolveServiceTierRegion(
		provider,
		region,
		configIndex,
		variant,
	);
	return supportsServiceTier(
		model,
		provider,
		serviceTier,
		effectiveRegion ?? null,
	)
		? serviceTier
		: undefined;
}

/**
 * Whether a catalog mapping can serve the requested premium tier. Used to
 * narrow the routing candidate set before a provider is picked, so neither the
 * initial attempt nor any fallback can land on a mapping that would drop the
 * tier.
 */
export function mappingSupportsRequestedServiceTier(
	model: string,
	mapping: Pick<ProviderModelMapping, "providerId" | "region">,
	serviceTier: "flex" | "priority",
	configIndex?: number,
	variant?: EnvVarVariant,
): boolean {
	return (
		getForwardedServiceTier(
			model,
			mapping.providerId as Provider,
			mapping.region,
			serviceTier,
			configIndex,
			variant,
		) !== undefined
	);
}

/**
 * Fails an attempt that would reach the upstream at a lower tier than the
 * client explicitly asked for.
 *
 * A dropped tier is invisible to the caller — the request succeeds, just slower
 * or more expensive than the tier it was billed against — so every dispatch
 * path asserts the invariant instead of falling back to standard. Routing and
 * credential selection already exclude mappings and keys that cannot serve the
 * tier; this is the backstop that keeps a provider/key/region resolved *after*
 * those filters (a fallback provider, a rotated key) from quietly downgrading
 * the request.
 *
 * Only applies to a tier the client requested itself. The dev-plan (DevPass)
 * org-level default is deliberately soft: it is a cost preference, not a
 * requirement, so an attempt that cannot serve it runs at standard instead of
 * failing.
 */
export function assertServiceTierHonored(options: {
	clientRequestedServiceTier: "flex" | "priority" | null;
	forwardedServiceTier: "flex" | "priority" | undefined;
	provider: string;
	model: string;
	region: string | undefined;
}): void {
	if (!options.clientRequestedServiceTier || options.forwardedServiceTier) {
		return;
	}
	const target = options.region
		? `${options.provider}/${options.model}:${options.region}`
		: `${options.provider}/${options.model}`;
	throw new HTTPException(400, {
		message: `Service tier '${options.clientRequestedServiceTier}' is not available for ${target}.`,
		cause: "unsupported_service_tier",
	});
}

/**
 * The endpoint region a provider-key row routes through, mirroring what
 * `getProviderEndpoint` reads. A platform-managed credential carries its
 * settings in `config` — surfaced to the endpoint builder as `env_config`, and
 * read here in both shapes so a row works whether or not it has been through
 * `managedCredentialOptions` — plus the `region` scoping column. BYOK keys never
 * set any of these for Vertex; their location comes from the environment, which
 * `resolveServiceTierRegion` reads instead.
 */
function providerKeyRegion(key: ProviderKeyRow): string | undefined {
	return (
		key.config?.region ??
		key.options?.env_config?.region ??
		key.region ??
		undefined
	);
}

/**
 * Whether a provider-key row (BYOK or platform-managed) can carry a
 * Flex/Priority request. Shared by every key-selection path so a service-tier
 * request cannot rotate onto a credential — on the first attempt or on a
 * fallback — whose upstream would silently serve it as standard.
 */
export function providerKeySupportsServiceTier(key: ProviderKeyRow): boolean {
	return providerCredentialSupportsServiceTier(key.provider as Provider, {
		baseUrl: key.config?.baseUrl ?? key.baseUrl,
		region: providerKeyRegion(key),
	});
}
