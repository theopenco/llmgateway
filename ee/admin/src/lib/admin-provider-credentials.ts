"use server";

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

function toErrorMessage(error: unknown, fallback: string): string {
	return (error as { message?: string } | undefined)?.message ?? fallback;
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
	const { data, error } = await $api.POST("/admin/provider-credentials", {
		body,
	});
	if (error || !data) {
		return {
			success: false,
			error: toErrorMessage(error, "Failed to create credential"),
		};
	}
	return { success: true };
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
	const { data, error } = await $api.PATCH("/admin/provider-credentials/{id}", {
		params: { path: { id } },
		body,
	});
	if (error || !data) {
		return {
			success: false,
			error: toErrorMessage(error, "Failed to update credential"),
		};
	}
	return { success: true };
}

export async function deleteProviderCredential(
	id: string,
): Promise<MutationResult> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.DELETE(
		"/admin/provider-credentials/{id}",
		{
			params: { path: { id } },
		},
	);
	if (error || !data?.success) {
		return {
			success: false,
			error: toErrorMessage(error, "Failed to delete credential"),
		};
	}
	return { success: true };
}

/**
 * Sends one minimal completion through a credential — stored or still in the
 * dialog — and reports the outcome without storing anything.
 */
export async function selfTestProviderCredential(
	body: CredentialTestInput,
): Promise<MutationResult & { result?: ProviderCredentialSelfTestResult }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/provider-credentials/self-test",
		{ body },
	);
	if (error || !data) {
		return {
			success: false,
			error: toErrorMessage(error, "Failed to test credential"),
		};
	}
	return { success: true, result: data };
}

/**
 * Probes each listed model through a credential and returns the per-model
 * report, so an admin can confirm the account has the models before saving.
 */
export async function verifyProviderCredentialModels(
	body: CredentialTestInput & { models: string[] },
): Promise<MutationResult & { result?: ProviderCredentialModelVerification }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/provider-credentials/verify-models",
		{ body },
	);
	if (error || !data) {
		return {
			success: false,
			error: toErrorMessage(error, "Failed to verify models"),
		};
	}
	return { success: true, result: data };
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
	const { data, error } = await $api.PUT("/admin/provider-credentials/order", {
		body: { provider, credentialIds },
	});
	if (error || !data) {
		return {
			success: false,
			error: toErrorMessage(error, "Failed to save credential order"),
		};
	}
	return { success: true };
}
