import { cookies } from "next/headers";
import createFetchClient from "openapi-fetch";

import { getConfig } from "./config-server";

import type { paths } from "./api/v1";

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
			Cookie: secureSessionCookie
				? `__Secure-${key}=${secureSessionCookie.value}`
				: sessionCookie
					? `${key}=${sessionCookie.value}`
					: "",
		},
	});
}
