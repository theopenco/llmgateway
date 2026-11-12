import { getTimeZonePreference } from "@/lib/timezone-server";

import {
	apiKeyUsageQuery,
	parseApiKeyUsageSelection,
	type ApiKeyUsageQuery,
} from "./api-key-usage-period";

export interface ApiKeyUsageSearchParams {
	period?: string | string[];
	from?: string | string[];
	to?: string | string[];
}

/** The usage query an API keys page renders first, in the cookie's timezone. */
export async function getInitialApiKeyUsageQuery(
	searchParams: ApiKeyUsageSearchParams,
): Promise<ApiKeyUsageQuery> {
	const selection = parseApiKeyUsageSelection(searchParams);
	if (selection.period !== "custom") {
		return { period: selection.period };
	}
	const { timeZone } = await getTimeZonePreference();
	return apiKeyUsageQuery(selection, timeZone);
}
