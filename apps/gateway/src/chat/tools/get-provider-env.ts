import { HTTPException } from "hono/http-exception";

import {
	getRoundRobinValue,
	parseCommaSeparatedEnv,
	peekRoundRobinValue,
} from "@/lib/round-robin-env.js";

import { providerKeyBaseUrlSupportsServiceTier } from "@llmgateway/actions";
import {
	getProviderEnvValue,
	getProviderEnvVar,
	getProviderEnvConfig,
	type Provider,
} from "@llmgateway/models";

export interface ProviderEnvResult {
	token: string;
	configIndex: number;
	envVarName: string;
}

function getEnvCredentialCount(provider: Provider): number {
	const envVar = getProviderEnvVar(provider);
	const value = envVar ? process.env[envVar] : undefined;
	if (!value) {
		return 0;
	}
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0).length;
}

/**
 * Whether a single env credential index can carry a Flex/Priority service-tier
 * request. Requires:
 * - an eligible base URL (managed default / canonical upstream, not a proxy);
 * - for google-vertex, a global region — Flex/Priority PayGo is served only on
 *   the global endpoint, and a non-global index would have its tier header
 *   dropped by getForwardedServiceTier and be silently served as standard.
 *
 * Base URL and region are comma-indexed in lockstep with the API-key env var,
 * so this is evaluated per index.
 */
function isServiceTierEligibleEnvIndex(
	provider: Provider,
	index: number,
): boolean {
	const baseUrl = getProviderEnvValue(provider, "baseUrl", index);
	if (!providerKeyBaseUrlSupportsServiceTier(provider, baseUrl)) {
		return false;
	}
	if (provider === "google-vertex") {
		const region = getProviderEnvValue(provider, "region", index, "global");
		if (region !== "global") {
			return false;
		}
	}
	return true;
}

/**
 * Env credential indices that are NOT eligible to carry a Flex/Priority
 * service-tier request. Used to exclude those indices from round-robin
 * selection so a service-tier request lands on a credential that hits the real
 * upstream on a tier-capable endpoint.
 */
export function getServiceTierIneligibleEnvIndices(
	provider: Provider,
): Set<number> {
	const ineligible = new Set<number>();
	const count = getEnvCredentialCount(provider);
	for (let index = 0; index < count; index++) {
		if (!isServiceTierEligibleEnvIndex(provider, index)) {
			ineligible.add(index);
		}
	}
	return ineligible;
}

/**
 * Whether at least one env credential for the provider targets an upstream
 * endpoint eligible for service-tier requests.
 */
export function hasServiceTierEligibleEnvCredential(
	provider: Provider,
): boolean {
	const count = getEnvCredentialCount(provider);
	for (let index = 0; index < count; index++) {
		if (isServiceTierEligibleEnvIndex(provider, index)) {
			return true;
		}
	}
	return false;
}

interface GetProviderEnvOptions {
	advanceRoundRobin?: boolean;
	excludedIndices?: ReadonlySet<number>;
	selectionScope?: string;
}

/**
 * Get provider token from environment variables with round-robin support
 * Supports comma-separated values in environment variables for load balancing
 * @param usedProvider The provider to get the token for
 * @returns Object containing the token and the config index used
 */
export function getProviderEnv(
	usedProvider: Provider,
	options: GetProviderEnvOptions = {},
): ProviderEnvResult {
	const envVar = getProviderEnvVar(usedProvider);
	if (!envVar) {
		throw new HTTPException(500, {
			message: `No environment variable set for provider: ${usedProvider}`,
		});
	}
	const envValue = process.env[envVar];
	if (!envValue) {
		throw new HTTPException(500, {
			message: `No API key set in environment for provider: ${usedProvider}`,
		});
	}

	// Validate required env vars for the provider
	const config = getProviderEnvConfig(usedProvider);
	if (config?.required) {
		for (const [key, envVarName] of Object.entries(config.required)) {
			if (key === "apiKey" || !envVarName) {
				continue;
			} // Already validated above
			if (!process.env[envVarName]) {
				throw new HTTPException(500, {
					message: `${envVarName} environment variable is required for ${usedProvider} provider`,
				});
			}
		}
	}

	const advanceRoundRobin = options.advanceRoundRobin ?? true;
	const excludedIndices = options.excludedIndices;
	const selectionScope = options.selectionScope;
	const result = advanceRoundRobin
		? getRoundRobinValue(envVar, envValue, selectionScope, excludedIndices)
		: peekRoundRobinValue(envVar, envValue, selectionScope, excludedIndices);

	return { token: result.value, configIndex: result.index, envVarName: envVar };
}

/**
 * Returns the number of comma-separated values configured in the named env
 * var, or 0 if it's unset/empty. Pass the resolved `envVarName` from the
 * provider context — it may be a regional override (e.g. `*__SINGAPORE`)
 * rather than the provider's base var.
 */
export function getEnvKeyCount(envVarName: string | undefined): number {
	if (!envVarName) {
		return 0;
	}
	const value = process.env[envVarName];
	if (!value) {
		return 0;
	}
	return parseCommaSeparatedEnv(value).length;
}
