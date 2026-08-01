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

export type EnvVarVariant = "enterprise" | "plans";

export const ENV_VAR_VARIANT_SUFFIXES: Record<EnvVarVariant, string> = {
	enterprise: "__ENTERPRISE",
	plans: "__PLANS",
};

/**
 * Resolve which env-var variant applies to an organization's request:
 * enterprise-plan orgs use the `__ENTERPRISE` overrides; plan-based
 * (non-PAYG) orgs — DevPass coding plans and Chat plans — use the
 * `__PLANS` overrides; everyone else (regular PAYG credits/BYOK orgs)
 * uses the base vars. Enterprise wins should an org ever match both.
 */
export function getOrganizationEnvVariant(
	organization:
		| {
				plan: string;
				kind?: string | null;
				devPlan?: string | null;
				chatPlan?: string | null;
		  }
		| null
		| undefined,
): EnvVarVariant | undefined {
	if (!organization) {
		return undefined;
	}
	if (organization.plan === "enterprise") {
		return "enterprise";
	}
	if (
		(organization.kind === "devpass" &&
			organization.devPlan &&
			organization.devPlan !== "none") ||
		(organization.kind === "chat" &&
			organization.chatPlan &&
			organization.chatPlan !== "none")
	) {
		return "plans";
	}
	return undefined;
}

/**
 * Name of the variant override env var (`{baseEnvVarName}__ENTERPRISE` /
 * `{baseEnvVarName}__PLANS`), returned only when it is actually set.
 * Applies to any provider env var: API keys, base URLs, regions, projects,
 * and other provider-specific settings.
 */
export function getVariantEnvVarNameFor(
	baseEnvVarName: string,
	variant: EnvVarVariant | undefined,
): string | undefined {
	if (!variant) {
		return undefined;
	}
	const variantName = `${baseEnvVarName}${ENV_VAR_VARIANT_SUFFIXES[variant]}`;
	return process.env[variantName] ? variantName : undefined;
}

/**
 * Variant override env var for the provider's API key credential, returned
 * only when it is actually set. Matching orgs use it instead of the base env
 * var; all other organizations never read it.
 */
export function getVariantEnvVarName(
	provider: Provider | string,
	variant: EnvVarVariant | undefined,
): string | undefined {
	const baseEnvVar = getProviderEnvVar(provider);
	if (!baseEnvVar) {
		return undefined;
	}
	return getVariantEnvVarNameFor(baseEnvVar, variant);
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
	variant?: EnvVarVariant,
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

	// A set variant override var replaces the base var wholesale (including
	// its comma-separated list); an unset one falls back to the base var.
	const effectiveEnvVarName =
		getVariantEnvVarNameFor(envVarName, variant) ?? envVarName;
	const envValue = process.env[effectiveEnvVarName];

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

export type VertexTokenType = "api-key" | "oauth";

interface VertexTokenTypeOptions {
	google_vertex_token_type?: VertexTokenType;
}

/**
 * Google Vertex AI accepts either an API key (sent as `?key=`) or an OAuth2
 * Bearer token. Resolution order: provider-key option → env var → "api-key".
 */
export function resolveVertexTokenType(
	provider: "google-vertex",
	providerKeyOptions?: VertexTokenTypeOptions,
	configIndex?: number,
	skipEnvVars?: boolean,
	variant?: EnvVarVariant,
): VertexTokenType {
	const optionValue = providerKeyOptions?.google_vertex_token_type;
	if (optionValue === "api-key" || optionValue === "oauth") {
		return optionValue;
	}
	if (!skipEnvVars) {
		const envValue = getProviderEnvValue(
			provider,
			"tokenType",
			configIndex,
			undefined,
			variant,
		);
		if (envValue === "api-key" || envValue === "oauth") {
			return envValue;
		}
	}
	return "api-key";
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
 * Get the region-specific env var name only when that var is actually set.
 * Returns `{BASE_ENV_VAR}__{REGION}` when the regional override exists, else
 * undefined. Use this when you need to attribute health to the regional
 * credential rather than the base env var.
 *
 * With a variant (enterprise-plan or DevPass orgs), the variant-regional
 * name `{BASE_ENV_VAR}__ENTERPRISE__{REGION}` / `{BASE_ENV_VAR}__PLANS__{REGION}`
 * is checked first and wins over the shared regional var when set.
 */
export function getRegionSpecificEnvVarName(
	provider: Provider,
	region: string,
	variant?: EnvVarVariant,
): string | undefined {
	const baseEnvVar = getProviderEnvVar(provider);
	if (!baseEnvVar) {
		return undefined;
	}
	const regionSuffix = region.toUpperCase().replace(/-/g, "_");
	if (variant) {
		const variantRegionalName = `${baseEnvVar}${ENV_VAR_VARIANT_SUFFIXES[variant]}__${regionSuffix}`;
		if (process.env[variantRegionalName]) {
			return variantRegionalName;
		}
	}
	const regionalName = `${baseEnvVar}__${regionSuffix}`;
	return process.env[regionalName] ? regionalName : undefined;
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
	const def = getProviderDefinition(provider);
	if (process.env[baseEnvVar]) {
		// The base key covers the provider's default region, and — for providers
		// whose credential is shared across regions (e.g. AWS Bedrock) — every
		// region, so non-default regions don't need a per-region env key.
		if (
			def?.regionConfig?.defaultRegion === region ||
			def?.regionConfig?.sharedCredentialAcrossRegions
		) {
			return true;
		}
	}
	return false;
}
