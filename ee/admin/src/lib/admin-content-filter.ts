import { apiErrorMessage } from "./api-error";
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
	const { data, error, response } = await $api.GET(
		"/admin/content-filter/violations",
		{
			params: {
				query: {
					window,
					sort,
					minSampled: sort === "rate" ? MIN_SAMPLED_FOR_RATE : 0,
				},
			},
		},
	);
	if (!response.ok || !data) {
		throw new Error(
			apiErrorMessage(error, "Failed to load content filter data", response),
		);
	}
	return data;
}

export type ContentFilterErrorKind =
	| "upstream_4xx"
	| "upstream_5xx"
	| "timeout"
	| "network"
	| "bad_response"
	| "unexpected";

export async function getContentFilterErrors(
	window: ContentFilterViolationsWindow,
	kind?: ContentFilterErrorKind,
) {
	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/content-filter/errors", {
		params: { query: { window, kind } },
	});
	return data ?? null;
}

export async function getContentFilterFocusOrganizations(
	window: ContentFilterViolationsWindow,
	usedProvider: string,
	usedModel?: string,
) {
	const $api = await createServerApiClient();
	const { data, error, response } = await $api.GET(
		"/admin/content-filter/violations/organizations",
		{
			params: { query: { window, usedProvider, usedModel } },
		},
	);
	if (!response.ok || !data) {
		throw new Error(
			apiErrorMessage(error, "Failed to load content filter data", response),
		);
	}
	return data;
}
