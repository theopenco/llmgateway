import { createServerApiClient } from "./server-api";

import type { paths } from "./api/v1";
import type { ErrorWindow } from "./provider-key-error-window";

export type ProviderCredential =
	paths["/admin/provider-credentials"]["get"]["responses"]["200"]["content"]["application/json"]["credentials"][number];

export type ProviderCredentialCatalogEntry =
	paths["/admin/provider-credentials/catalog"]["get"]["responses"]["200"]["content"]["application/json"]["providers"][number];

export type ProviderCredentialSelfTestResult =
	paths["/admin/provider-credentials/self-test"]["post"]["responses"]["200"]["content"]["application/json"];

export type ProviderCredentialModelVerification =
	paths["/admin/provider-credentials/verify-models"]["post"]["responses"]["200"]["content"]["application/json"];

/**
 * Identifies the credential a test endpoint should probe: a stored one via
 * `credentialId` (its token is read server-side), or unsaved dialog values.
 * Explicit fields win over the stored ones.
 */
export interface CredentialTestInput {
	credentialId?: string;
	provider?: string;
	token?: string;
	config?: Record<string, string>;
	region?: string | null;
}

export async function getProviderCredentials(
	includeDeleted = false,
	errorWindow?: ErrorWindow,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/provider-credentials", {
		params: {
			query: {
				...(includeDeleted ? { includeDeleted: "true" as const } : {}),
				...(errorWindow ? { errorWindow } : {}),
			},
		},
	});
	return data ?? null;
}

export async function getProviderCredentialCatalog() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/provider-credentials/catalog");
	return data ?? null;
}
