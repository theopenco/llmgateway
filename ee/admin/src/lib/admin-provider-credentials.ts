"use server";

import { apiErrorMessage, thrownErrorMessage } from "./api-error";
import { createServerApiClient } from "./server-api";

import type { paths } from "./api/v1";

export type ProviderCredential =
	paths["/admin/provider-credentials"]["get"]["responses"]["200"]["content"]["application/json"]["credentials"][number];

export type ProviderCredentialCatalogEntry =
	paths["/admin/provider-credentials/catalog"]["get"]["responses"]["200"]["content"]["application/json"]["providers"][number];

export type ProviderCredentialSelfTestResult =
	paths["/admin/provider-credentials/self-test"]["post"]["responses"]["200"]["content"]["application/json"];

export type ProviderCredentialModelVerification =
	paths["/admin/provider-credentials/verify-models"]["post"]["responses"]["200"]["content"]["application/json"];

export interface CredentialInput {
	provider: string;
	token: string;
	comment?: string;
	variant?: "default" | "enterprise" | "plans";
	region?: string;
	config?: Record<string, string>;
	usageLimit?: string | null;
	allowedModels?: string[] | null;
	skipValidation?: boolean;
}

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

interface MutationResult {
	success: boolean;
	error?: string;
}

interface FetchOutcome<T> {
	data?: T;
	error?: unknown;
	response: Response;
}

/**
 * Runs one API call and reduces it to `{ success, error?, result? }`, keeping
 * hold of the reason it failed. Both halves matter to the caller: an error
 * response carries its message in one of several envelopes, and a request that
 * throws would otherwise leave the server action with an opaque failure.
 */
async function request<T>(
	fallback: string,
	call: () => Promise<FetchOutcome<T>>,
	isSuccess: (data: T) => boolean = () => true,
): Promise<MutationResult & { result?: T }> {
	let outcome: FetchOutcome<T>;
	try {
		outcome = await call();
	} catch (cause) {
		return { success: false, error: thrownErrorMessage(cause, fallback) };
	}

	const { data, error, response } = outcome;
	if (error || !data || !isSuccess(data)) {
		return {
			success: false,
			error: apiErrorMessage(error, fallback, response),
		};
	}
	return { success: true, result: data };
}

export async function getProviderCredentials() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/provider-credentials");
	return data ?? null;
}

export async function getProviderCredentialCatalog() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/provider-credentials/catalog");
	return data ?? null;
}

export async function createProviderCredential(
	body: CredentialInput,
): Promise<MutationResult> {
	const $api = await createServerApiClient();
	const { success, error } = await request("Failed to create credential", () =>
		$api.POST("/admin/provider-credentials", { body }),
	);
	return { success, error };
}

export async function updateProviderCredential(
	id: string,
	body: {
		token?: string;
		comment?: string | null;
		variant?: "default" | "enterprise" | "plans";
		region?: string | null;
		status?: "active" | "inactive";
		config?: Record<string, string>;
		usageLimit?: string | null;
		allowedModels?: string[] | null;
		skipValidation?: boolean;
	},
): Promise<MutationResult> {
	const $api = await createServerApiClient();
	const { success, error } = await request("Failed to update credential", () =>
		$api.PATCH("/admin/provider-credentials/{id}", {
			params: { path: { id } },
			body,
		}),
	);
	return { success, error };
}

export async function deleteProviderCredential(
	id: string,
): Promise<MutationResult> {
	const $api = await createServerApiClient();
	const { success, error } = await request(
		"Failed to delete credential",
		() =>
			$api.DELETE("/admin/provider-credentials/{id}", {
				params: { path: { id } },
			}),
		(data) => data.success,
	);
	return { success, error };
}

/**
 * Sends one minimal completion through a credential — stored or still in the
 * dialog — and reports the outcome without storing anything.
 */
export async function selfTestProviderCredential(
	body: CredentialTestInput,
): Promise<MutationResult & { result?: ProviderCredentialSelfTestResult }> {
	const $api = await createServerApiClient();
	return await request("Failed to test credential", () =>
		$api.POST("/admin/provider-credentials/self-test", { body }),
	);
}

/**
 * Probes each listed model through a credential and returns the per-model
 * report, so an admin can confirm the account has the models before saving.
 */
export async function verifyProviderCredentialModels(
	body: CredentialTestInput & { models: string[] },
): Promise<MutationResult & { result?: ProviderCredentialModelVerification }> {
	const $api = await createServerApiClient();
	return await request("Failed to verify models", () =>
		$api.POST("/admin/provider-credentials/verify-models", { body }),
	);
}

/**
 * Sets the order the gateway tries a provider's managed credentials. The first
 * is preferred; the rest are fallbacks when one is unhealthy.
 */
export async function reorderProviderCredentials(
	provider: string,
	credentialIds: string[],
): Promise<MutationResult> {
	const $api = await createServerApiClient();
	const { success, error } = await request(
		"Failed to save credential order",
		() =>
			$api.PUT("/admin/provider-credentials/order", {
				body: { provider, credentialIds },
			}),
	);
	return { success, error };
}
