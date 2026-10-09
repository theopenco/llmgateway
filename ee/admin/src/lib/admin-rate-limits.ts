import { createServerApiClient } from "./server-api";

export async function getGlobalRateLimits() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/rate-limits");
	return data ?? null;
}

export async function getOrganizationRateLimits(orgId: string) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/organizations/{orgId}/rate-limits", {
		params: { path: { orgId } },
	});
	return data ?? null;
}

export async function getRateLimitOptions() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/rate-limits/options");
	return data ?? null;
}
