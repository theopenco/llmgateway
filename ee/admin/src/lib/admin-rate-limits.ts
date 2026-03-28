"use server";

import { createServerApiClient } from "./server-api";

export async function getGlobalRateLimits() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/rate-limits");
	return data ?? null;
}

export async function createGlobalRateLimit(body: {
	provider?: string | null;
	model?: string | null;
	limitType: "rpm" | "rpd";
	maxRequests: number;
	reason?: string | null;
}) {
	const $api = await createServerApiClient();
	const { data } = await $api.POST("/admin/rate-limits", { body });
	return data ?? null;
}

export async function deleteGlobalRateLimit(
	rateLimitId: string,
): Promise<boolean> {
	const $api = await createServerApiClient();
	const { data } = await $api.DELETE("/admin/rate-limits/{rateLimitId}", {
		params: { path: { rateLimitId } },
	});
	return data?.success ?? false;
}

export async function getOrganizationRateLimits(orgId: string) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/organizations/{orgId}/rate-limits", {
		params: { path: { orgId } },
	});
	return data ?? null;
}

export async function createOrganizationRateLimit(
	orgId: string,
	body: {
		provider?: string | null;
		model?: string | null;
		limitType: "rpm" | "rpd";
		maxRequests: number;
		reason?: string | null;
	},
) {
	const $api = await createServerApiClient();
	const { data } = await $api.POST("/admin/organizations/{orgId}/rate-limits", {
		params: { path: { orgId } },
		body,
	});
	return data ?? null;
}

export async function deleteOrganizationRateLimit(
	orgId: string,
	rateLimitId: string,
): Promise<boolean> {
	const $api = await createServerApiClient();
	const { data } = await $api.DELETE(
		"/admin/organizations/{orgId}/rate-limits/{rateLimitId}",
		{
			params: { path: { orgId, rateLimitId } },
		},
	);
	return data?.success ?? false;
}

export async function getRateLimitOptions() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/rate-limits/options");
	return data ?? null;
}
