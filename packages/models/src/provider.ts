import {
	providers,
	type ProviderEnvConfig,
	getProviderDefinition,
} from "./providers.js";

import type { Provider } from "./index.js";

export type { ProviderEnvConfig };

export const providerEnvVarMap: Record<Provider, string | undefined> =
	Object.fromEntries(
		providers.map((provider) => [
			provider.id,
			(provider.env.required as Record<string, string | undefined>).apiKey,
		]),
	) as Record<Provider, string | undefined>;

export function getProviderEnvVar(
	provider: Provider | string,
): string | undefined {
	return providerEnvVarMap[provider as Provider];
}

export function getProviderEnvConfig(
	provider: Provider | string,
): ProviderEnvConfig | undefined {
	const def = getProviderDefinition(provider);
	return def?.env;
}

export function hasProviderEnvironmentToken(
	provider: Provider | string,
): boolean {
	const envVar = getProviderEnvVar(provider);
	return envVar ? Boolean(process.env[envVar]) : false;
}

export function getProviderEnvValue(
	provider: Provider,
	key: string,
	configIndex?: number,
	defaultValue?: string,
): string | undefined {
	const config = getProviderEnvConfig(provider);
	if (!config) {
		return undefined;
	}

	let envVarName: string | undefined;

	// Check required vars first, then optional
	if (key in config.required) {
		envVarName = config.required[key as keyof typeof config.required];
	} else if (config.optional && key in config.optional) {
		envVarName = config.optional[key];
	}

	if (!envVarName) {
		return defaultValue;
	}

	const envValue = process.env[envVarName];

	if (!envValue) {
		return defaultValue;
	}

	const values = envValue
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);

	if (values.length === 0) {
		return defaultValue;
	}

	if (configIndex === undefined) {
		return values[0];
	}

	if (configIndex >= values.length) {
		return values[values.length - 1];
	}

	return values[configIndex];
}

export function validateProviderEnv(provider: Provider): string[] {
	const config = getProviderEnvConfig(provider);
	if (!config) {
		return [`Unknown provider: ${provider}`];
	}

	const errors: string[] = [];

	// Check all required env vars
	for (const [key, envVarName] of Object.entries(config.required)) {
		if (envVarName && !process.env[envVarName]) {
			errors.push(`Missing required env var: ${envVarName} (${key})`);
		}
	}

	return errors;
}

/**
 * Get a region-specific environment variable value.
 * Checks for `{BASE_ENV_VAR}__{REGION}` first, then falls back to the base env var.
 * Region is normalized to uppercase with hyphens replaced by underscores.
 *
 * Example: getRegionSpecificEnvValue("alibaba", "us-virginia")
 *   → checks LLM_ALIBABA_API_KEY__US_VIRGINIA, then LLM_ALIBABA_API_KEY
 */
export function getRegionSpecificEnvValue(
	provider: Provider,
	region: string,
): string | undefined {
	const baseEnvVar = getProviderEnvVar(provider);
	if (!baseEnvVar) {
		return undefined;
	}
	const regionSuffix = region.toUpperCase().replace(/-/g, "_");
	return (
		process.env[`${baseEnvVar}__${regionSuffix}`] ?? process.env[baseEnvVar]
	);
}

/**
 * Check whether an env var exists for a specific region.
 * Returns true if a region-specific env var (`{BASE_ENV_VAR}__{REGION}`) exists,
 * OR if the base env var exists and the queried region is the provider's default region.
 */
export function hasRegionSpecificEnvKey(
	provider: Provider,
	region: string,
): boolean {
	const baseEnvVar = getProviderEnvVar(provider);
	if (!baseEnvVar) {
		return false;
	}
	const regionSuffix = region.toUpperCase().replace(/-/g, "_");
	if (process.env[`${baseEnvVar}__${regionSuffix}`]) {
		return true;
	}
	// The base key covers the provider's default region
	const def = getProviderDefinition(provider);
	if (def?.regionConfig?.defaultRegion === region && process.env[baseEnvVar]) {
		return true;
	}
	return false;
}
