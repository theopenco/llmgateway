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

export async function deleteUser(userId: string): Promise<boolean> {
	const $api = await createServerApiClient();
	const { data } = await $api.DELETE("/admin/users/{userId}", {
		params: { path: { userId } },
	});
	return data?.success ?? false;
}
