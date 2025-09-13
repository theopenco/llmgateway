import { cookies } from "next/headers";

const COOKIE_NAME = "llmgateway-last-used-project";

/**
 * Get the last used project ID from cookies (server-side)
 */
export async function getLastUsedProjectId(
	orgId: string,
): Promise<string | null> {
	const cookieStore = await cookies();
	const cookie = cookieStore.get(`${COOKIE_NAME}-${orgId}`);
	return cookie?.value ?? null;
}

/**
 * Set the last used project ID in cookies (server-side)
 */
export async function setLastUsedProjectId(
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
