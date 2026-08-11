import {
	providers,
	type ProviderEnvConfig,
	type ProviderEnvExclusiveGroup,
	getProviderDefinition,
	regionEndpointRequiresWorkspaceId,
} from "./providers.js";

import type { Provider } from "./index.js";

export type { ProviderEnvConfig, ProviderEnvExclusiveGroup };

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

/**
 * One configurable setting of a provider credential: the logical key it is
 * addressed by (`apiKey`, `baseUrl`, `project`, `region`, …), the environment
 * variable that carries it when the credential is configured through env vars,
 * and whether the provider needs it at all.
 */
export interface ProviderEnvKey {
	key: string;
	envVar: string;
	required: boolean;
}

/**
 * Every setting a provider credential can carry, required ones first. Drives
 * both the admin dashboard's credential form (which renders one field per
 * entry) and server-side validation of managed credentials, so a provider that
 * gains a new env var automatically gains the matching field.
 *
 * `apiKey` is included: it is the credential's token and is stored encrypted
 * rather than alongside the other settings, so callers that only want the
 * accompanying settings should filter it out.
 */
export function getProviderEnvKeys(
	provider: Provider | string,
): ProviderEnvKey[] {
	const config = getProviderEnvConfig(provider);
	if (!config) {
		return [];
	}
	const keys: ProviderEnvKey[] = [];
	for (const [key, envVar] of Object.entries(config.required)) {
		if (envVar) {
			keys.push({ key, envVar, required: true });
		}
	}
	for (const [key, envVar] of Object.entries(config.optional ?? {})) {
		if (envVar) {
			keys.push({ key, envVar, required: false });
		}
	}
	return keys;
}

/**
 * Groups of settings where exactly one member must be supplied (e.g. Azure's
 * resource vs base URL). Drives the credential form's hint and the save-time
 * check, so neither has to name the providers involved.
 */
export function getProviderEnvExclusiveGroups(
	provider: Provider | string,
): ProviderEnvExclusiveGroup[] {
	return getProviderEnvConfig(provider)?.exclusive ?? [];
}

/**
 * Human-readable complaints about a credential's settings: one per exclusive
 * group that is unsatisfied, naming what was supplied and what was expected.
 * Empty when every group holds exactly one value.
 */
export function getProviderEnvExclusiveViolations(
	provider: Provider | string,
	config: Record<string, string | undefined> | null | undefined,
): string[] {
	const violations: string[] = [];

	for (const group of getProviderEnvExclusiveGroups(provider)) {
		const supplied = group.keys.filter((key) => config?.[key]?.trim());

		if (supplied.length === 1) {
			continue;
		}

		violations.push(
			supplied.length === 0
				? `Set one of ${formatKeyList(group.keys, "or")}.`
				: `Set only one of ${formatKeyList(group.keys, "or")} — ${formatKeyList(supplied, "and")} were both supplied.`,
		);
	}

	return violations;
}

function formatKeyList(keys: string[], conjunction: "and" | "or"): string {
	if (keys.length <= 1) {
		return keys.join("");
	}
	return `${keys.slice(0, -1).join(", ")} ${conjunction} ${keys[keys.length - 1]}`;
}

export function hasProviderEnvironmentToken(
	provider: Provider | string,
): boolean {
	const envVar = getProviderEnvVar(provider);
	return envVar ? Boolean(process.env[envVar]) : false;
}

/**
 * Environment variable carrying a provider's setting for one logical env key
 * (`apiKey`, `baseUrl`, `region`, `workspaceId`, …), or undefined when the
 * provider does not declare that setting.
 */
export function getProviderEnvVarNameFor(
	provider: Provider,
	key: string,
): string | undefined {
	const config = getProviderEnvConfig(provider);
	if (!config) {
		return undefined;
	}
	if (key in config.required) {
		return config.required[key as keyof typeof config.required];
	}
	return config.optional?.[key];
}

export function getProviderEnvValue(
	provider: Provider,
	key: string,
	configIndex?: number,
	defaultValue?: string,
	variant?: EnvVarVariant,
): string | undefined {
	if (!getProviderEnvConfig(provider)) {
		return undefined;
	}

	const envVarName = getProviderEnvVarNameFor(provider, key);

	if (!envVarName) {
		return defaultValue;
	}

	// A set variant override var replaces the base var wholesale (including
	// its comma-separated list); an unset one falls back to the base var.
	const effectiveEnvVarName =
		getVariantEnvVarNameFor(envVarName, variant) ?? envVarName;
	return selectEnvListValue(
		process.env[effectiveEnvVarName],
		configIndex,
		defaultValue,
	);
}

/**
 * Pick one entry out of a comma-separated env var. A deployment can rotate or
 * shard a setting by listing several values; `configIndex` selects the one
 * belonging to the credential in play, clamping to the last entry so a short
 * list never leaves a credential without a value.
 */
function selectEnvListValue(
	envValue: string | undefined,
	configIndex?: number,
	defaultValue?: string,
): string | undefined {
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
	env_config?: Record<string, string>;
}

/**
 * Google Vertex AI accepts either an API key (sent as `?key=`) or an OAuth2
 * Bearer token. Resolution order: provider-key option → managed-credential
 * config → env var → "api-key".
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
	const configValue = providerKeyOptions?.env_config?.tokenType;
	if (configValue === "api-key" || configValue === "oauth") {
		return configValue;
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
 * Suffix a region contributes to an env var name (`us-virginia` → `US_VIRGINIA`).
 *
 * Every reader and every enumerator of regional credentials must derive the
 * name the same way — a variable spelled differently than the gateway looks it
 * up is simply never read.
 */
export function getRegionEnvVarSuffix(region: string): string {
	return region.toUpperCase().replace(/-/g, "_");
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
	const regionSuffix = getRegionEnvVarSuffix(region);
	return (
		process.env[`${baseEnvVar}__${regionSuffix}`] ?? process.env[baseEnvVar]
	);
}

/**
 * Region-scoped read of any provider setting, not just the API key: checks
 * `{ENV_VAR}__{VARIANT}__{REGION}` and `{ENV_VAR}__{REGION}` before falling
 * back to the plain lookup. Settings that differ per region without being
 * credentials — Alibaba's per-region Model Studio workspace id, for instance —
 * are resolved through this so they follow the same naming, variant precedence
 * and comma-separated list selection as the regional keys they accompany.
 */
export function getRegionScopedProviderEnvValue(
	provider: Provider,
	key: string,
	region: string | undefined,
	configIndex?: number,
	variant?: EnvVarVariant,
): string | undefined {
	const envVarName = getProviderEnvVarNameFor(provider, key);
	if (region && envVarName) {
		const regionSuffix = getRegionEnvVarSuffix(region);
		const candidates = variant
			? [
					`${envVarName}${ENV_VAR_VARIANT_SUFFIXES[variant]}__${regionSuffix}`,
					`${envVarName}__${regionSuffix}`,
				]
			: [`${envVarName}__${regionSuffix}`];
		for (const candidate of candidates) {
			if (process.env[candidate]) {
				return selectEnvListValue(process.env[candidate], configIndex);
			}
		}
	}
	return getProviderEnvValue(provider, key, configIndex, undefined, variant);
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
	const regionSuffix = getRegionEnvVarSuffix(region);
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
 *
 * A region whose endpoint is workspace-scoped additionally needs its workspace
 * id configured: the key alone cannot address the region, so treating it as
 * available would route traffic to an endpoint that cannot be built.
 */
export function hasRegionSpecificEnvKey(
	provider: Provider,
	region: string,
): boolean {
	const baseEnvVar = getProviderEnvVar(provider);
	if (!baseEnvVar) {
		return false;
	}
	if (
		regionEndpointRequiresWorkspaceId(provider, region) &&
		!getRegionScopedProviderEnvValue(provider, "workspaceId", region)
	) {
		return false;
	}
	const regionSuffix = getRegionEnvVarSuffix(region);
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
