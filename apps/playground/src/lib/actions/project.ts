"use server";

import { cookies } from "next/headers";

import { PLAYGROUND_KEY_COOKIE_NAMES } from "@/lib/constants";

const COOKIE_NAME = "llmgateway-last-used-project";

/**
 * Server Action to set the last used project ID in cookies
 */
export async function setLastUsedProjectAction(
	orgId: string,
	projectId: string,
): Promise<void> {
	const cookieStore = await cookies();
	cookieStore.set(`${COOKIE_NAME}-${orgId}`, projectId, {
		httpOnly: true, // Secure HTTP-only cookie
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 60 * 60 * 24 * 30, // 30 days
		path: "/",
	});
}

/**
 * Server Action to clear cookies that should not persist across users on logout:
 * last-used-project cookies and the auto-generated playground API key cookie.
 */
export async function clearLastUsedProjectCookiesAction(): Promise<void> {
	const cookieStore = await cookies();

	const allCookies = cookieStore.getAll();

	for (const cookie of allCookies) {
		if (cookie.name.startsWith(COOKIE_NAME)) {
			cookieStore.delete(cookie.name);
		}
	}

	for (const name of PLAYGROUND_KEY_COOKIE_NAMES) {
		cookieStore.delete(name);
	}
}
