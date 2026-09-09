import { providers } from "@llmgateway/models";

/**
 * Clamp the requested temperature to the ceiling the selected provider accepts.
 * The OpenAI schema allows temperature up to 2, but providers such as zai reject
 * anything above 1 with a 400, so lower the value instead of failing the request.
 */
export function clampTemperature(
	temperature: number | undefined,
	providerId: string,
	mappingMaxTemperature?: number,
): number | undefined {
	if (temperature === undefined) {
		return undefined;
	}
	const providerMaxTemperature = providers.find(
		(p) => p.id === providerId,
	)?.maxTemperature;
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
