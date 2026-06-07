import {
	type ProviderId,
	type ProviderModelMapping,
	type ProviderRequestBody,
	providers,
	type ServiceTierId,
} from "@llmgateway/models";

const STANDARD_SERVICE_TIERS = new Set<ServiceTierId>(["auto", "default"]);
const OPENAI_SERVICE_TIER_PROVIDERS = new Set<ProviderId>(["openai"]);
const GOOGLE_BODY_TIER_PROVIDERS = new Set<ProviderId>([
	"google-ai-studio",
	"glacier",
]);

export function providerUsesServiceTierField(provider: ProviderId): boolean {
	return (
		OPENAI_SERVICE_TIER_PROVIDERS.has(provider) ||
		GOOGLE_BODY_TIER_PROVIDERS.has(provider)
	);
}

export function mappingSupportsServiceTier(
	mapping: Pick<ProviderModelMapping, "providerId" | "supportedServiceTiers">,
	serviceTier: ServiceTierId | undefined,
): boolean {
	if (serviceTier === undefined) {
		return true;
	}

	if (STANDARD_SERVICE_TIERS.has(serviceTier)) {
		return (
			providerUsesServiceTierField(mapping.providerId) ||
			providers.some(
				(provider) =>
					provider.id === mapping.providerId &&
					(provider.serviceTiers?.length ?? 0) > 0,
			)
		);
	}

	if (mapping.supportedServiceTiers?.includes(serviceTier)) {
		return true;
	}

	const providerTier = providers
		.find((provider) => provider.id === mapping.providerId)
		?.serviceTiers?.some((tier) => tier.id === serviceTier);
	if (providerTier) {
		return true;
	}

	return (
		GOOGLE_BODY_TIER_PROVIDERS.has(mapping.providerId) &&
		(serviceTier === "flex" || serviceTier === "priority")
	);
}

export function getSupportedServiceTiers(
	mapping: Pick<ProviderModelMapping, "providerId" | "supportedServiceTiers">,
): ServiceTierId[] {
	const supported = new Set<ServiceTierId>();

	if (providerUsesServiceTierField(mapping.providerId)) {
		supported.add("auto");
		supported.add("default");
	}

	if (
		providers.some(
			(provider) =>
				provider.id === mapping.providerId &&
				(provider.serviceTiers?.length ?? 0) > 0,
		)
	) {
		supported.add("auto");
		supported.add("default");
	}

	for (const serviceTier of mapping.supportedServiceTiers ?? []) {
		supported.add(serviceTier);
	}

	for (const serviceTier of providers.find(
		(provider) => provider.id === mapping.providerId,
	)?.serviceTiers ?? []) {
		supported.add(serviceTier.id);
	}

	if (GOOGLE_BODY_TIER_PROVIDERS.has(mapping.providerId)) {
		supported.add("flex");
		supported.add("priority");
	}

	return [...supported];
}

export function applyOpenAIServiceTier(
	body: ProviderRequestBody | FormData,
	provider: ProviderId,
	serviceTier: ServiceTierId | undefined,
): void {
	if (
		serviceTier === undefined ||
		!OPENAI_SERVICE_TIER_PROVIDERS.has(provider) ||
		body instanceof FormData
	) {
		return;
	}

	(body as { service_tier?: ServiceTierId }).service_tier = serviceTier;
}

export function resolveOpenAIServedServiceTier(
	response: unknown,
): ServiceTierId | null {
	if (
		typeof response !== "object" ||
		response === null ||
		!("service_tier" in response)
	) {
		return null;
	}

	const serviceTier = (response as { service_tier?: unknown }).service_tier;
	if (
		serviceTier === "auto" ||
		serviceTier === "default" ||
		serviceTier === "flex" ||
		serviceTier === "priority" ||
		serviceTier === "scale"
	) {
		return serviceTier;
	}

	return null;
}
