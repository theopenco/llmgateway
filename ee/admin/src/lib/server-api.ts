import { headers } from "next/headers";
import createFetchClient from "openapi-fetch";

import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";

import { getConfig } from "./config-server";
import { getSessionCookieHeader } from "./session-cookie";

import type { paths } from "./api/v1";

export async function createServerApiClient() {
	const config = getConfig();

	return createFetchClient<paths>({
		baseUrl: config.apiBackendUrl,
		credentials: "include",
		headers: {
			// Forward the visitor's address so the API's per-IP limits bucket
			// them individually rather than lumping every visitor of a
			// server-rendered page behind this server's own address.
			...forwardedIpHeaders(await headers()),
			Cookie: await getSessionCookieHeader(),
		},
	});
}
