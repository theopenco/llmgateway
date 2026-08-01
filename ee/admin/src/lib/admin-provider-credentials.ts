"use server";

import { createServerApiClient } from "./server-api";

import type { paths } from "./api/v1";

export type ProviderCredential =
	paths["/admin/provider-credentials"]["get"]["responses"]["200"]["content"]["application/json"]["credentials"][number];

export type ProviderCredentialCatalogEntry =
	paths["/admin/provider-credentials/catalog"]["get"]["responses"]["200"]["content"]["application/json"]["providers"][number];

export interface CredentialInput {
	provider: string;
	token: string;
	comment?: string;
	variant?: "default" | "enterprise" | "plans";
	region?: string;
	config?: Record<string, string>;
	usageLimit?: string | null;
	skipValidation?: boolean;
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
