import { MIN_SAMPLED_FOR_RATE } from "./content-filter-ranking";
import { createServerApiClient } from "./server-api";

import type {
	ContentFilterViolationsSort,
	ContentFilterViolationsWindow,
} from "./content-filter-ranking";

export async function getContentFilterViolations(
	window: ContentFilterViolationsWindow,
	sort: ContentFilterViolationsSort = "violations",
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/content-filter/violations", {
		params: {
			query: {
				window,
				sort,
				minSampled: sort === "rate" ? MIN_SAMPLED_FOR_RATE : 0,
			},
		},
	});
	return data ?? null;
}

export async function getContentFilterFocusOrganizations(
	window: ContentFilterViolationsWindow,
	usedProvider: string,
	usedModel?: string,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET(
		"/admin/content-filter/violations/organizations",
		{
			params: { query: { window, usedProvider, usedModel } },
		},
	);
	return data ?? null;
}
