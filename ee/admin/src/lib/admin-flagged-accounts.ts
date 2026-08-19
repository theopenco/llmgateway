"use server";

import { createServerApiClient } from "./server-api";

export async function getFlaggedAccounts(params: {
	status?: "flagged" | "approved" | "all";
	search?: string;
	archived?: boolean;
}) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/flagged-accounts", {
		params: {
			query: {
				status: params.status,
				...(params.search && { search: params.search }),
				archived: params.archived ? "true" : "false",
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

export async function setFlaggedAccountArchived(
	userId: string,
	archived: boolean,
): Promise<{ success: boolean; error?: string }> {
	const $api = await createServerApiClient();
	const { data, error } = await $api.PATCH(
		"/admin/flagged-accounts/{userId}/archive",
		{
			params: { path: { userId } },
			body: { archived },
		},
	);

	if (error || !data) {
		const message =
			(error as { message?: string } | undefined)?.message ??
			`Failed to ${archived ? "archive" : "restore"} account`;
		return { success: false, error: message };
	}

	return { success: true };
}
