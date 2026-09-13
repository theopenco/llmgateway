import { cookies, headers } from "next/headers";
import createFetchClient from "openapi-fetch";
import { cache } from "react";

import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";

import { getConfig } from "./config-server";

import type { paths } from "./api/v1";
import type { UserMe } from "@/hooks/useUser";

export async function createServerApiClient() {
	const config = getConfig();
	const cookieStore = await cookies();

	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(`${key}`);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);

	return createFetchClient<paths>({
		baseUrl: config.apiBackendUrl,
		credentials: "include",
		headers: {
			// Forward the visitor's address so the API's per-IP limits bucket
			// them individually rather than lumping every visitor of a
			// server-rendered page behind this server's own address.
			...forwardedIpHeaders(await headers()),
			Cookie: secureSessionCookie
				? `__Secure-${key}=${secureSessionCookie.value}`
				: sessionCookie
					? `${key}=${sessionCookie.value}`
					: "",
		},
	});
}

// The dashboard layout and pages request this independently in the same
// render pass; cache() collapses the duplicate round-trips into one.
export const getUserMe = cache(async (): Promise<UserMe | null> => {
	const client = await createServerApiClient();
	const { data, response } = await client.GET("/user/me");
	if (!response.ok) {
		// Only an actual auth failure means "anonymous". Anything else (backend
		// down, 5xx) must surface as an error rather than bouncing a signed-in
		// user to /login.
		if (response.status === 401) {
			return null;
		}
		throw new Error(
			`Failed to load the current user (status ${response.status})`,
		);
	}
	return data ?? null;
});
