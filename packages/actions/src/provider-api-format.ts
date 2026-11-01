import {
	expandAllProviderRegions,
	getProviderDefinition,
	models,
	type Provider,
	type ProviderModelMapping,
	type RequestApiFormat,
} from "@llmgateway/models";

export function getProviderApiTransport(
	provider: Provider,
	apiFormat: RequestApiFormat | undefined,
): Provider {
	if (!apiFormat || apiFormat === "provider-native") {
		return provider;
	}
	if (apiFormat === "anthropic-messages") {
		return "anthropic";
	}
	return apiFormat === "google-vertex" ? "google-vertex" : "openai";
}

/**
 * API surface a request is sent on: the mapping's `webSearchApiFormat` when
 * the request carries a web search tool, else its `apiFormat`.
 */
export function getRequestApiFormat(
	mapping:
		Pick<ProviderModelMapping, "apiFormat" | "webSearchApiFormat"> | undefined,
	hasWebSearch: boolean,
): RequestApiFormat | undefined {
	if (hasWebSearch && mapping?.webSearchApiFormat) {
		return mapping.webSearchApiFormat;
	}
	return mapping?.apiFormat;
}

/**
 * Model-id prefix of the cross-region inference profile serving an AWS Bedrock
 * OpenAI-format mapping in `region`, or undefined when the region is served
 * in-region by Mantle.
 */
export function getBedrockProfilePrefix(
	mapping: ProviderModelMapping | undefined,
	region: string | null | undefined,
): string | undefined {
	if (!mapping?.crossRegionProfiles) {
		return undefined;
	}
	const regionConfig = getProviderDefinition("aws-bedrock")?.regionConfig;
	return (
		regionConfig?.modelPrefixMap?.[region ?? regionConfig.defaultRegion] ||
		undefined
	);
}

/**
 * Upstream model id for a request: the catalogue `externalId`, prefixed with
 * the inference profile when an AWS Bedrock OpenAI-format mapping is served
 * through one. Reads the static catalogue, since `crossRegionProfiles` is not
 * synced to database mappings.
 */
export function getUpstreamModelId(
	provider: string,
	modelId: string,
	externalId: string,
	region: string | null | undefined,
): string {
	if (provider !== "aws-bedrock") {
		return externalId;
	}
	const mapping = expandAllProviderRegions(
		models.find((m) => m.id === modelId)?.providers ?? [],
	).find((p) => p.providerId === provider && !p.region);
	if (mapping?.apiFormat !== "openai-chat-completions") {
		return externalId;
	}
	return `${getBedrockProfilePrefix(mapping, region) ?? ""}${externalId}`;
}
