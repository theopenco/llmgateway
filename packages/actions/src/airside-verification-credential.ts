import { createHmac } from "node:crypto";

import { getProviderDefinition, getProviderEnvKeys } from "@llmgateway/models";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

import { getProviderDefaultBaseUrl } from "./get-provider-endpoint.js";
import { modelVerificationEnvironmentToken } from "./model-verification-target.js";

import type { tables, ProviderModelVerificationTarget } from "@llmgateway/db";
import type { ProviderId } from "@llmgateway/models";

type VerificationProviderKey = Pick<
	typeof tables.providerKey.$inferSelect,
	| "id"
	| "provider"
	| "tokenCiphertext"
	| "config"
	| "region"
	| "variant"
	| "allowedModels"
	| "options"
	| "baseUrl"
>;

/** Bind verification proof to the credential and deployment configuration. */
export function providerVerificationCredentialFingerprint(
	key: VerificationProviderKey,
	baseUrl?: string | null,
): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update("airside-verification-credential:v1:")
		.update(
			JSON.stringify([
				key.id,
				key.provider,
				key.tokenCiphertext,
				key.config,
				key.region,
				key.variant,
				key.allowedModels,
				key.options,
				baseUrl ?? key.baseUrl ?? null,
			]),
		)
		.digest("hex");
}
export function environmentVerificationCredentialFingerprint(
	target: ProviderModelVerificationTarget,
	token = modelVerificationEnvironmentToken(target),
): string {
	const roots = [
		`LLM_${target.providerId.toUpperCase().replaceAll("-", "_")}_BASE_URL`,
		...getProviderEnvKeys(target.providerId).map((key) => key.envVar),
	];
	const config = Object.entries(process.env)
		.filter(([name]) =>
			roots.some((root) => name === root || name.startsWith(`${root}__`)),
		)
		.sort(([left], [right]) => left.localeCompare(right));
	return createHmac("sha256", getApiKeyHashSecret())
		.update("airside-verification-environment:v1:")
		.update(
			JSON.stringify([
				target.providerId,
				target.region ?? null,
				target.apiFormat ?? null,
				token,
				getProviderDefaultBaseUrl(target.providerId as ProviderId),
				getProviderDefinition(target.providerId)?.regionConfig,
				config,
			]),
		)
		.digest("hex");
}
