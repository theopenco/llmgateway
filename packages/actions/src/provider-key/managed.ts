import { getProviderEnvKeys, providers } from "@llmgateway/models";

import type { ProviderKeyOptions } from "@llmgateway/db";
import type { ProviderDefinition } from "@llmgateway/models";

/**
 * Columns of a managed provider-key row that describe the credential beyond
 * its token. Kept structural so callers can pass a full Drizzle row, an SWR
 * mirror, or a plain literal in tests.
 */
export interface ManagedCredentialRowLike {
	options?: ProviderKeyOptions | null;
	config?: Record<string, string> | null;
}

/**
 * Provider-key options to use when a managed credential is the credential
 * being sent: the row's `config` column surfaced as `env_config`, which
 * endpoint and token-type resolution consult ahead of the deployment's `LLM_*`
 * environment variables. A managed credential therefore describes itself in
 * full and needs no env var to be set for the provider.
 *
 * Returns undefined when the row carries neither options nor config, so
 * callers can pass the result straight through to `getProviderEndpoint`.
 */
export function managedCredentialOptions(
	row: ManagedCredentialRowLike | null | undefined,
): ProviderKeyOptions | undefined {
	if (!row) {
		return undefined;
	}
	const config = row.config;
	if (!config || Object.keys(config).length === 0) {
		return row.options ?? undefined;
	}
	return { ...(row.options ?? {}), env_config: config };
}

/**
 * Options for validating a managed credential before it is stored.
 *
 * Same settings the gateway will send with the credential, plus one bridge: a
 * managed credential records its region in its own `region` column (it selects
 * which region's traffic the credential serves), while `validateProviderKey`
 * reads the region from the provider's option key. Without this, a regional
 * credential would be checked against the provider's default region instead of
 * the one it will actually serve.
 */
export function managedCredentialValidationOptions(
	provider: string,
	config: Record<string, string> | null | undefined,
	region: string | null | undefined,
): ProviderKeyOptions {
	const options: ProviderKeyOptions = {
		...(managedCredentialOptions({ options: null, config }) ?? {}),
	};

	const providerDef = providers.find((p) => p.id === provider) as
		ProviderDefinition | undefined;
	const regionOptionsKey = providerDef?.regionConfig?.optionsKey;
	const effectiveRegion = config?.region ?? region?.trim();
	if (regionOptionsKey && effectiveRegion) {
		(options as Record<string, string>)[regionOptionsKey] = effectiveRegion;
	}

	return options;
}

/**
 * The credential settings a provider accepts, excluding the API key itself
 * (which is stored encrypted in the token columns rather than in `config`).
 */
export function getManagedCredentialConfigKeys(provider: string) {
	return getProviderEnvKeys(provider).filter((entry) => entry.key !== "apiKey");
}

/**
 * Settings the provider requires but the submitted config does not supply.
 * A managed credential is only usable once every one of these is present,
 * because nothing falls back to the environment for it.
 */
export function getMissingManagedCredentialKeys(
	provider: string,
	config: Record<string, string> | null | undefined,
): string[] {
	return getManagedCredentialConfigKeys(provider)
		.filter((entry) => entry.required)
		.filter((entry) => !config?.[entry.key]?.trim())
		.map((entry) => entry.key);
}

/**
 * Rejects config keys the provider does not declare. Unknown keys are always a
 * mistake — they would be silently ignored at request time and leave the
 * credential looking configured when it is not.
 */
export function getUnknownManagedCredentialKeys(
	provider: string,
	config: Record<string, string> | null | undefined,
): string[] {
	if (!config) {
		return [];
	}
	const known = new Set(
		getManagedCredentialConfigKeys(provider).map((entry) => entry.key),
	);
	return Object.keys(config).filter((key) => !known.has(key));
}
