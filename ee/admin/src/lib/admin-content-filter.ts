"use server";

import { createServerApiClient } from "./server-api";

export type ContentFilterViolationsWindow = "24h" | "7d" | "30d";

export async function getContentFilterViolations(
	window: ContentFilterViolationsWindow,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/content-filter/violations", {
		params: { query: { window } },
	});
	return data ?? null;
}
