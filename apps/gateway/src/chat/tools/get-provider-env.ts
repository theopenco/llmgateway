import { HTTPException } from "hono/http-exception";

import { getProviderEnvVar, type Provider } from "@llmgateway/models";

/**
 * Get provider token from environment variables
 * @param usedProvider The provider to get the token for
 * @returns The token for the provider
 */
export function getProviderEnv(usedProvider: Provider): string {
	const envVar = getProviderEnvVar(usedProvider);
	if (!envVar) {
		throw new HTTPException(400, {
			message: `No environment variable set for provider: ${usedProvider}`,
		});
	}
	const token = process.env[envVar];
	if (!token) {
		throw new HTTPException(400, {
			message: `No API key set in environment for provider: ${usedProvider}`,
		});
	}
	return token;
}
