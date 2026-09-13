import { headers } from "next/headers";

import { getConfig } from "@/lib/config-server";
import { getSessionCookieHeader } from "@/lib/session-cookie";

import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";

export interface SessionUser {
	id: string;
	email: string;
	name: string | null;
	isAdmin: boolean;
}

export async function getUser(): Promise<SessionUser | null> {
	const config = getConfig();

	const res = await fetch(`${config.apiBackendUrl}/user/me`, {
		method: "GET",
		headers: {
			// Forward the visitor's address so the API's per-IP limits bucket
			// them individually rather than behind this server's own address.
			...forwardedIpHeaders(await headers()),
			Cookie: await getSessionCookieHeader(),
		},
	});

	if (!res.ok) {
		return null;
	}

	const data = (await res.json()) as { user?: SessionUser };

	return data.user ?? null;
}

/**
 * Same as {@link getUser}, but only resolves for users on the API's admin
 * allowlist. Route handlers under `/api/*` must use this: the session cookie is
 * shared with the main dashboard, and the proxy skips its admin check for that
 * path prefix, so any signed-in user reaches them otherwise.
 */
export async function getAdminUser(): Promise<SessionUser | null> {
	const user = await getUser();

	return user?.isAdmin ? user : null;
}
