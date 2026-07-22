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
