import type {
	ModelDefinition,
	ProviderDefinition,
	StabilityLevel,
} from "@llmgateway/models";

/**
 * Minimal structural shapes of the API `/internal/models` payload. They are
 * deliberately looser than the full `ApiModel`/`ApiProvider` types so that
 * selectors can accept either the catalogue definitions from
 * `@llmgateway/models` or anything API-shaped, without every caller having to
 * hand over the complete response object.
 */
export interface ApiMappingLike {
	providerId: string;
	region?: string | null;
	stability?: StabilityLevel | null;
	deprecatedAt?: string | null;
	deactivatedAt?: string | null;
}

export interface ApiModelLike {
	id: string;
	name?: string | null;
	releasedAt?: string | null;
	stability?: StabilityLevel | null;
	mappings: ApiMappingLike[];
}

export interface ApiProviderLike {
	id: string;
	name?: string | null;
	color?: string | null;
}

export type UnifiedModel = ModelDefinition | ApiModelLike;
export type UnifiedProvider = ProviderDefinition | ApiProviderLike;

/**
 * A provider mapping reduced to the fields every selector needs, regardless of
 * whether it came from the catalogue or from the API.
 */
export interface UnifiedMapping {
	providerId: string;
	region: string | null;
	stability?: StabilityLevel | null;
	deprecatedAt?: string | Date | null;
	deactivatedAt?: string | Date | null;
}

export function isApiModel(model: UnifiedModel): model is ApiModelLike {
	return "mappings" in model;
}

export function getModelMappings(model: UnifiedModel): UnifiedMapping[] {
	if (isApiModel(model)) {
		return model.mappings.map((mapping) => ({
			providerId: mapping.providerId,
			region: mapping.region ?? null,
			stability: mapping.stability,
			deprecatedAt: mapping.deprecatedAt,
			deactivatedAt: mapping.deactivatedAt,
		}));
	}
	return model.providers.map((mapping) => ({
		providerId: mapping.providerId,
		region: mapping.region ?? null,
		stability: mapping.stability,
		deprecatedAt: mapping.deprecatedAt,
		deactivatedAt: mapping.deactivatedAt,
	}));
}

export function getModelReleasedAt(
	model: UnifiedModel,
): string | Date | undefined {
	if (isApiModel(model)) {
		return model.releasedAt ?? undefined;
	}
	return model.releasedAt;
}

export function getModelName(model: UnifiedModel): string {
	return model.name ?? model.id;
}

export function getProviderName(provider: UnifiedProvider | undefined): string {
	return provider?.name ?? provider?.id ?? "";
}

export function isDeactivated(
	at: string | Date | null | undefined,
	now: Date,
): boolean {
	return at ? new Date(at) <= now : false;
}

export function isUnstableStability(
	stability: StabilityLevel | null | undefined,
): boolean {
	return stability === "unstable" || stability === "experimental";
}

/**
 * The gateway model string for a mapping: `provider/model`, with the region
 * suffix appended only when the caller opts into regional variants.
 */
export function formatMappingValue(
	providerId: string,
	modelId: string,
	region?: string | null,
): string {
	return region
		? `${providerId}/${modelId}:${region}`
		: `${providerId}/${modelId}`;
}

export function parseMappingValue(value: string | undefined | null): {
	providerId: string | null;
	modelId: string;
	region: string | null;
} {
	const raw = value ?? "";
	const slash = raw.indexOf("/");
	const providerId = slash === -1 ? null : raw.slice(0, slash);
	const rest = slash === -1 ? raw : raw.slice(slash + 1);
	const colon = rest.indexOf(":");
	return {
		providerId,
		modelId: colon === -1 ? rest : rest.slice(0, colon),
		region: colon === -1 ? null : rest.slice(colon + 1),
	};
}
