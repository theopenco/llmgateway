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
