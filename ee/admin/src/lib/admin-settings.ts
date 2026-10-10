import { createServerApiClient } from "./server-api";

import type { SystemBannerSeverity } from "@llmgateway/shared";

export async function getCreditPurchaseBlock() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/credit-purchase-block");
	return data ?? null;
}

export async function getBlockedSignupCountries() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/blocked-signup-countries");
	return data ?? null;
}

export type ForceThreeDSecureMode = "off" | "any" | "challenge";

export async function getForceThreeDSecure() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/force-3ds");
	return data ?? null;
}

export interface SystemBannerSettingInput {
	enabled: boolean;
	message: string;
	severity: SystemBannerSeverity;
	linkUrl: string | null;
	linkLabel: string | null;
}

export async function getSystemBanner() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/banner");
	return data ?? null;
}

export interface ContentFilterSettingsInput {
	enabled: boolean;
	providerIds: string[];
	sampleRatePercent: number;
	enforce: boolean;
	enforceEnterprise: boolean;
	classifier: "openai" | "jev" | "internal";
	internalScope: "full" | "latest_turn";
	moderateImages: boolean;
}

export async function getContentFilterSettings() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/content-filter");
	return data ?? null;
}

export async function getBlockedSignupEmailDomains() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/settings/blocked-signup-email-domains",
	);
	return data ?? null;
}

export async function getModelErrorRateAlerts() {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/settings/model-error-rate-alerts");
	return data ?? null;
}
