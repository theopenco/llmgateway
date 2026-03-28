import { HTTPException } from "hono/http-exception";

import {
	getRoundRobinValue,
	peekRoundRobinValue,
} from "@/lib/round-robin-env.js";

import {
	getProviderEnvVar,
	getProviderEnvConfig,
	type Provider,
} from "@llmgateway/models";

export interface ProviderEnvResult {
	token: string;
	configIndex: number;
	envVarName: string;
}

interface GetProviderEnvOptions {
	advanceRoundRobin?: boolean;
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
	const result = advanceRoundRobin
		? getRoundRobinValue(envVar, envValue)
		: peekRoundRobinValue(envVar, envValue);

	return { token: result.value, configIndex: result.index, envVarName: envVar };
}
