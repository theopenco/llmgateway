import { HTTPException } from "hono/http-exception";

import { getRoundRobinValue } from "@/lib/round-robin-env.js";

import { getProviderEnvVar, type Provider } from "@llmgateway/models";

export interface ProviderEnvResult {
	token: string;
	configIndex: number;
}

/**
 * Get provider token from environment variables with round-robin support
 * Supports comma-separated values in environment variables for load balancing
 * @param usedProvider The provider to get the token for
 * @returns Object containing the token and the config index used
 */
export function getProviderEnv(usedProvider: Provider): ProviderEnvResult {
	const envVar = getProviderEnvVar(usedProvider);
	if (!envVar) {
		throw new HTTPException(400, {
			message: `No environment variable set for provider: ${usedProvider}`,
		});
	}
	const envValue = process.env[envVar];
	if (!envValue) {
		throw new HTTPException(400, {
			message: `No API key set in environment for provider: ${usedProvider}`,
		});
	}

	if (usedProvider === "azure") {
		if (!process.env.LLM_AZURE_RESOURCE) {
			throw new HTTPException(400, {
				message: `LLM_AZURE_RESOURCE environment variable is required for Azure provider`,
			});
		}
	}

	// Get the next token using round-robin
	const result = getRoundRobinValue(envVar, envValue);

	return { token: result.value, configIndex: result.index };
}
