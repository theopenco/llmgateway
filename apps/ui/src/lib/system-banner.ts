import createFetchClient from "openapi-fetch";

import { getConfig } from "./config-server";

import type { paths } from "./api/v1";
import type { SystemBanner } from "@llmgateway/shared";

/**
 * Admin-toggled announcement banner. Revalidated often enough that switching
 * it off takes effect within seconds, without a backend read per page view.
 */
export async function fetchSystemBanner(): Promise<SystemBanner | null> {
	const client = createFetchClient<paths>({
		baseUrl: getConfig().apiBackendUrl,
	});

	try {
		const { data } = await client.GET("/public/banner", {
			next: { revalidate: 30 },
		});
		return data?.banner ?? null;
	} catch (error) {
		// Every page renders this: a backend outage must not blank the site,
		// which is exactly when an incident banner would be configured.
		console.error("Failed to load the announcement banner:", error);
		return null;
	}
}
