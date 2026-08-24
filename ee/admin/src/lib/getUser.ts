import { getConfig } from "@/lib/config-server";
import { getSessionCookieHeader } from "@/lib/session-cookie";

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
