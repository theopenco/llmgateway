import { getGcpServiceAccountProjectId } from "@llmgateway/actions";
import {
	type EnvVarVariant,
	getVariantEnvVarNameFor,
} from "@llmgateway/models";

const BASE_ENV_VAR = "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON";

function readServiceAccountJson(variant?: EnvVarVariant): string | undefined {
	return process.env[
		getVariantEnvVarNameFor(BASE_ENV_VAR, variant) ?? BASE_ENV_VAR
	];
}

export function getVertexAnthropicProjectId(
	variant?: EnvVarVariant,
): string | null {
	const json = readServiceAccountJson(variant);
	return json ? getGcpServiceAccountProjectId(json) : null;
}

/**
 * Vertex's Anthropic and OpenAI-compatible endpoints take an OAuth access
 * token. Each of their credentials (env var entry, managed or provider key) is
 * service-account JSON, so every attempt, retries included, mints the token
 * from the credential it selected.
 */
export function usesServiceAccountAccessToken(provider: string): boolean {
	return provider === "vertex-anthropic" || provider === "vertex-openai";
}
