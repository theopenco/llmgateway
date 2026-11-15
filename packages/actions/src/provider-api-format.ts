import {
	expandAllProviderRegions,
	getProviderDefinition,
	getProviderEnvValue,
	models,
	type EnvVarVariant,
	type Provider,
	type ProviderModelMapping,
	type RequestApiFormat,
} from "@llmgateway/models";

import type { ProviderKeyOptions } from "@llmgateway/db";

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

/** Whether an AWS Bedrock mapping is served through the Converse API. */
export function usesAwsBedrockConverse(
	provider: string | undefined,
	apiFormat: RequestApiFormat | undefined,
): boolean {
	return (
		provider === "aws-bedrock" &&
		(apiFormat === undefined || apiFormat === "provider-native")
	);
}

export interface AwsBedrockModelPrefixOptions {
	providerKeyOptions?: ProviderKeyOptions;
	/** BYOK and managed credentials ignore `LLM_AWS_BEDROCK_REGION`. */
	skipEnvVars?: boolean;
	configIndex?: number;
	variant?: EnvVarVariant;
}

/**
 * Inference-profile prefix (`global.`, `us.`, …, or "" in-region) of a Claude
 * model id on AWS Bedrock. A provider key's prefix wins over the region, which
 * wins over `LLM_AWS_BEDROCK_REGION`.
 */
export function getAwsBedrockModelPrefix(
	region: string | null | undefined,
	options?: AwsBedrockModelPrefixOptions,
): string {
	const regionPrefix = region
		? getProviderDefinition("aws-bedrock")?.regionConfig?.modelPrefixMap?.[
				region
			]
		: undefined;
	const configuredPrefix =
		options?.providerKeyOptions?.env_config?.region ??
		(options?.skipEnvVars
			? undefined
			: getProviderEnvValue(
					"aws-bedrock",
					"region",
					options?.configIndex,
					undefined,
					options?.variant,
				));
	return (
		options?.providerKeyOptions?.aws_bedrock_region_prefix ??
		regionPrefix ??
		configuredPrefix ??
		"global."
	);
}

/**
 * Upstream model id for a request: the catalogue `externalId`, prefixed with
 * the inference profile when an AWS Bedrock OpenAI-format mapping is served
 * through one, or when a Claude mapping on the Anthropic Messages API is
 * (which takes the model in the body). Reads the static catalogue, since
 * `crossRegionProfiles` is not synced to database mappings.
 */
export function getUpstreamModelId(
	provider: string,
	modelId: string,
	externalId: string,
	region: string | null | undefined,
	prefixOptions?: AwsBedrockModelPrefixOptions,
): string {
	if (provider !== "aws-bedrock") {
		return externalId;
	}
	const mapping = expandAllProviderRegions(
		models.find((m) => m.id === modelId)?.providers ?? [],
	).find((p) => p.providerId === provider && !p.region);
	if (mapping?.apiFormat === "anthropic-messages") {
		return `${getAwsBedrockModelPrefix(region, prefixOptions)}${externalId}`;
	}
	if (mapping?.apiFormat !== "openai-chat-completions") {
		return externalId;
	}
	return `${getBedrockProfilePrefix(mapping, region) ?? ""}${externalId}`;
}
