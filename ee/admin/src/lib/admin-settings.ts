"use server";

import { createServerApiClient } from "./server-api";

export async function getCreditPurchaseBlock() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/credit-purchase-block");
	return data ?? null;
}

export async function updateCreditPurchaseBlock(blocked: boolean) {
	const $api = await createServerApiClient();
	const { data } = await $api.PUT("/admin/settings/credit-purchase-block", {
		body: { blocked },
	});
	return data ?? null;
}
