import { providers } from "@llmgateway/models";

import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Clamp the requested temperature to the ceiling the selected provider accepts.
 * The OpenAI schema allows temperature up to 2, but providers such as zai reject
 * anything above 1 with a 400, so lower the value instead of failing the request.
 * A mapping on Anthropic's Messages API (Claude on AWS Bedrock) takes
 * Anthropic's ceiling.
 */
export function clampTemperature(
	temperature: number | undefined,
	providerId: string,
	mapping?: Pick<ProviderModelMapping, "maxTemperature" | "apiFormat">,
): number | undefined {
	if (temperature === undefined) {
		return undefined;
	}
	const ceilingProvider =
		mapping?.apiFormat === "anthropic-messages" ? "anthropic" : providerId;
	const providerMaxTemperature = providers.find(
		(p) => p.id === ceilingProvider,
	)?.maxTemperature;
	const mappingMaxTemperature = mapping?.maxTemperature;
	const maxTemperature =
		providerMaxTemperature === undefined
			? mappingMaxTemperature
			: mappingMaxTemperature === undefined
				? providerMaxTemperature
				: Math.min(providerMaxTemperature, mappingMaxTemperature);
	if (maxTemperature === undefined || temperature <= maxTemperature) {
		return temperature;
	}
	return maxTemperature;
}
