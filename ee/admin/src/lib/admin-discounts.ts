import { createServerApiClient } from "./server-api";

export async function getGlobalDiscounts() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/discounts");
	return data ?? null;
}

export async function getRoutingScoreMultipliers() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/routing-score-multipliers");
	return data ?? null;
}

export async function getAllOrganizationDiscounts() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/discounts/organizations");
	return data ?? null;
}

export async function getOrganizationDiscounts(orgId: string) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/organizations/{orgId}/discounts", {
		params: { path: { orgId } },
	});
	return data ?? null;
}

export async function getDiscountOptions() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/discounts/options");
	return data ?? null;
}
