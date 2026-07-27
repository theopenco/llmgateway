import { providers } from "@llmgateway/models";

/**
 * Clamp the requested temperature to the ceiling the selected provider accepts.
 * The OpenAI schema allows temperature up to 2, but providers such as zai reject
 * anything above 1 with a 400, so lower the value instead of failing the request.
 */
export function clampTemperature(
	temperature: number | undefined,
	providerId: string,
): number | undefined {
	if (temperature === undefined) {
		return undefined;
	}
	const maxTemperature = providers.find(
		(p) => p.id === providerId,
	)?.maxTemperature;
	if (maxTemperature === undefined || temperature <= maxTemperature) {
		return temperature;
	}
	return maxTemperature;
}
