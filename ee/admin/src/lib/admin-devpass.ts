"use server";

import { createServerApiClient } from "./server-api";

export async function giftResetPasses(
	orgId: string,
	body: { tier: "lite" | "pro" | "max"; count: number; comment?: string },
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/devpass/{orgId}/gift-reset-passes",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to gift Reset Passes";
		return { success: false, error: message };
	}

	return { success: true };
}

export async function refundDevpassPayment(
	orgId: string,
	body: {
		transactionId: string;
		amount?: number;
		reason: "requested_by_customer" | "duplicate" | "fraudulent";
		comment?: string;
	},
): Promise<{ success: boolean; message?: string; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST("/admin/devpass/{orgId}/refund", {
		params: { path: { orgId } },
		body,
	});

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to refund payment";
		return { success: false, error: message };
	}

	return { success: true, message: data.message };
}

export async function cancelDevpassSubscription(
	orgId: string,
	body: { immediate: boolean; comment?: string },
): Promise<{ success: boolean; message?: string; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/devpass/{orgId}/cancel-subscription",
		{
			params: { path: { orgId } },
			body,
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to cancel subscription";
		return { success: false, error: message };
	}

	return { success: true, message: data.message };
}
