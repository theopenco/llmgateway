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
