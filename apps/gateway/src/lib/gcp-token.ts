import {
	getGcpServiceAccountAccessToken,
	getGcpServiceAccountProjectId,
} from "@llmgateway/actions";
import {
	type EnvVarVariant,
	getVariantEnvVarNameFor,
} from "@llmgateway/models";

const BASE_ENV_VAR = "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON";

// Variant env vars give enterprise/plans orgs their own credential; the shared
// helper caches tokens per credential, so they never share a token.
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

export async function getGcpAccessToken(
	variant?: EnvVarVariant,
): Promise<string | null> {
	const json = readServiceAccountJson(variant);
	return json ? await getGcpServiceAccountAccessToken(json) : null;
}
