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

export async function getBlockedSignupCountries() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/blocked-signup-countries");
	return data ?? null;
}

export async function updateBlockedSignupCountries(countries: string[]) {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PUT(
		"/admin/settings/blocked-signup-countries",
		{ body: { countries } },
	);
	if (!data) {
		return {
			countries: null,
			message:
				(error as { message?: string } | undefined)?.message ??
				"Failed to update the blocked countries.",
		};
	}
	return { countries: data.countries, message: null };
}

export type ForceThreeDSecureMode = "off" | "any" | "challenge";

export async function getForceThreeDSecure() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/force-3ds");
	return data ?? null;
}

export async function updateForceThreeDSecure(mode: ForceThreeDSecureMode) {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PUT("/admin/settings/force-3ds", {
		body: { mode },
	});
	if (!data) {
		return {
			state: null,
			message:
				(error as { message?: string } | undefined)?.message ??
				"Failed to update the 3D Secure setting.",
		};
	}
	return { state: data, message: null };
}
