"use server";

import { createServerApiClient } from "./server-api";

import type { TokenWindow } from "./types";

export async function loadMetricsAction(orgId: string, window: TokenWindow) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/organizations/{orgId}", {
		params: { path: { orgId }, query: { window } },
	});
	return data ?? null;
}

export async function loadProjectMetricsAction(
	orgId: string,
	projectId: string,
	window: TokenWindow,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/organizations/{orgId}/projects/{projectId}/metrics",
		{
			params: { path: { orgId, projectId }, query: { window } },
		},
	);
	return data ?? null;
}

export async function loadProjectLogsAction(
	orgId: string,
	projectId: string,
	cursor?: string,
	filters?: {
		provider?: string;
		model?: string;
		source?: string;
		unifiedFinishReason?: string;
		hasError?: string;
	},
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/organizations/{orgId}/projects/{projectId}/logs",
		{
			params: {
				path: { orgId, projectId },
				query: { limit: 50, cursor, ...filters },
			},
		},
	);
	return data ?? null;
}

export async function giftCreditsToOrganization(
	orgId: string,
	body: { creditAmount: number; comment?: string },
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/organizations/{orgId}/gift-credits",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		return { success: false, error: "Failed to gift credits" };
	}

	return { success: true };
}

export async function addManualCreditsToOrganization(
	orgId: string,
	body: {
		creditAmount: number;
		paymentMethod: "wire" | "crypto" | "paypal" | "other";
		externalReference?: string;
		comment?: string;
	},
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/organizations/{orgId}/manual-credits",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		return { success: false, error: "Failed to add credits" };
	}

	return { success: true };
}

export interface EnterpriseDealInput {
	amount: number;
	paymentMethod: "wire" | "crypto" | "other";
	externalReference?: string;
	comment?: string;
}

export async function addEnterpriseDealToOrganization(
	orgId: string,
	body: EnterpriseDealInput,
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/organizations/{orgId}/enterprise-deals",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		return { success: false, error: "Failed to add enterprise deal" };
	}

	return { success: true };
}

export async function updateEnterpriseDeal(
	orgId: string,
	transactionId: string,
	body: EnterpriseDealInput,
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PATCH(
		"/admin/organizations/{orgId}/enterprise-deals/{transactionId}",
		{
			params: { path: { orgId, transactionId } },
			body,
		},
	);

	if (error || !data) {
		return { success: false, error: "Failed to update enterprise deal" };
	}

	return { success: true };
}

export async function updateReferralBonus(
	orgId: string,
	body: { enabled: boolean; percent: number },
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PATCH(
		"/admin/organizations/{orgId}/referral-bonus",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to update referral bonus";
		return { success: false, error: message };
	}

	return { success: true };
}

export async function manageOrganization(
	orgId: string,
	body: {
		name: string;
		plan: "free" | "pro" | "enterprise";
		seats: number | null;
		apiKeyLimit: number | null;
		projectLimit: number | null;
		trustTierOverride: number | null;
		planExpiresAt: string | null;
		planStartedAt: string | null;
		isTrialActive: boolean;
		trialStartDate: string | null;
		trialEndDate: string | null;
	},
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PATCH(
		"/admin/organizations/{orgId}/manage",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to update organization";
		return { success: false, error: message };
	}

	return { success: true };
}

export async function setOrganizationStatus(
	orgId: string,
	status: "active" | "deleted",
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PATCH(
		"/admin/organizations/{orgId}/status",
		{
			params: { path: { orgId } },
			body: { status },
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to update organization status";
		return { success: false, error: message };
	}

	return { success: true };
}

export async function deleteOrganizationPaymentMethod(
	orgId: string,
	paymentMethodId: string,
	replacementPaymentMethodId?: string,
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.DELETE(
		"/admin/organizations/{orgId}/payment-methods/{paymentMethodId}",
		{
			params: { path: { orgId, paymentMethodId } },
			body: { replacementPaymentMethodId },
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to delete payment method";
		return { success: false, error: message };
	}

	return { success: true };
}

export async function blockOrganization(orgId: string): Promise<{
	success: boolean;
	error?: string;
	cancelledSubscriptionIds?: string[];
}> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/organizations/{orgId}/block",
		{
			params: { path: { orgId } },
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to block organization";
		return { success: false, error: message };
	}

	return {
		success: true,
		cancelledSubscriptionIds: data.cancelledSubscriptionIds,
	};
}

export interface BulkBlockPreview {
	search: string;
	matched: number;
	blockable: number;
	skipped: number;
	maxBulkSize: number;
	organizations: {
		id: string;
		name: string;
		billingEmail: string;
		plan: string;
		status: string | null;
		createdAt: string;
	}[];
}

export async function previewBulkBlockOrganizations(search: string): Promise<{
	success: boolean;
	error?: string;
	preview?: BulkBlockPreview;
}> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.GET(
		"/admin/organizations/bulk-block/preview",
		{
			params: { query: { search } },
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to preview bulk block";
		return { success: false, error: message };
	}

	return { success: true, preview: data };
}

export async function bulkBlockOrganizations(
	search: string,
	expectedCount: number,
): Promise<{
	success: boolean;
	error?: string;
	blockedCount?: number;
	failedCount?: number;
	failed?: { id: string; name: string; error: string }[];
}> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST("/admin/organizations/bulk-block", {
		body: { search, expectedCount },
	});

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to bulk block organizations";
		return { success: false, error: message };
	}

	return {
		success: true,
		blockedCount: data.blockedCount,
		failedCount: data.failedCount,
		failed: data.failed,
	};
}

export async function getLogContent(logId: string): Promise<string | null> {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/logs/{id}", {
		params: { path: { id: logId } },
	});
	return data?.log?.content ?? null;
}
