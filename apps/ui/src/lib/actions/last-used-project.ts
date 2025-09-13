"use server";

import { cookies } from "next/headers";

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
 * Server Action to clear all last used project cookies on logout
 */
export async function clearLastUsedProjectCookiesAction(): Promise<void> {
	const cookieStore = await cookies();

	// Get all cookies to find and delete the last-used-project ones
	const allCookies = cookieStore.getAll();

	for (const cookie of allCookies) {
		if (cookie.name.startsWith(COOKIE_NAME)) {
			cookieStore.delete(cookie.name);
		}
	}
}
