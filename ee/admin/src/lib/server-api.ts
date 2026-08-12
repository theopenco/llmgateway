import createFetchClient from "openapi-fetch";

import { getConfig } from "./config-server";
import { getSessionCookieHeader } from "./session-cookie";

import type { paths } from "./api/v1";

export async function createServerApiClient() {
	const config = getConfig();

	return createFetchClient<paths>({
		baseUrl: config.apiBackendUrl,
		credentials: "include",
		headers: {
			Cookie: await getSessionCookieHeader(),
		},
	});
}
