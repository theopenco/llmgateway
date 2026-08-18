"use server";

import { createServerApiClient } from "./server-api";

export async function getFlaggedAccounts(params: {
	status?: "flagged" | "approved" | "all";
	search?: string;
}) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/flagged-accounts", {
		params: {
			query: {
				status: params.status,
				...(params.search && { search: params.search }),
				limit: 100,
			},
		},
	});
	return data ?? null;
}

export async function activateFlaggedAccount(
	userId: string,
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.POST(
		"/admin/flagged-accounts/{userId}/approve",
		{ params: { path: { userId } } },
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			"Failed to activate account";
		return { success: false, error: message };
	}

	return { success: true };
}
