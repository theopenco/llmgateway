"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "llmgateway-last-used-project";

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
