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
		httpOnly: false, // Allow client-side access for navigation
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: 60 * 60 * 24 * 30, // 30 days
		path: "/",
	});
}
