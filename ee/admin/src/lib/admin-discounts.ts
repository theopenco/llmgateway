"use server";

import { createServerApiClient } from "./server-api";

export async function getGlobalDiscounts() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/discounts");
	return data ?? null;
}

export async function createGlobalDiscount(body: {
	provider?: string | null;
	model?: string | null;
	discountPercent: number;
	reason?: string | null;
	expiresAt?: string | null;
}) {
	const $api = await createServerApiClient();
	const { data } = await $api.POST("/admin/discounts", { body });
	return data ?? null;
}

export async function deleteGlobalDiscount(
	discountId: string,
): Promise<boolean> {
	const $api = await createServerApiClient();
	const { data } = await $api.DELETE("/admin/discounts/{discountId}", {
		params: { path: { discountId } },
	});
	return data?.success ?? false;
}

export async function getOrganizationDiscounts(orgId: string) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/organizations/{orgId}/discounts", {
		params: { path: { orgId } },
	});
	return data ?? null;
}

export async function createOrganizationDiscount(
	orgId: string,
	body: {
		provider?: string | null;
		model?: string | null;
		discountPercent: number;
		reason?: string | null;
		expiresAt?: string | null;
	},
) {
	const $api = await createServerApiClient();
	const { data } = await $api.POST("/admin/organizations/{orgId}/discounts", {
		params: { path: { orgId } },
		body,
	});
	return data ?? null;
}

export async function deleteOrganizationDiscount(
	orgId: string,
	discountId: string,
): Promise<boolean> {
	const $api = await createServerApiClient();
	const { data } = await $api.DELETE(
		"/admin/organizations/{orgId}/discounts/{discountId}",
		{
			params: { path: { orgId, discountId } },
		},
	);
	return data?.success ?? false;
}

export async function getDiscountOptions() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/discounts/options");
	return data ?? null;
}
