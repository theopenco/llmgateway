const COOKIE_NAME = "llmgateway-last-used-project";

/**
 * Client-side utilities for managing last used project
 */
export const lastUsedProjectClient = {
	get: (orgId: string): string | null => {
		if (typeof document === "undefined") {
			return null;
		}
		const cookies = document.cookie.split(";");
		const cookie = cookies.find((c) =>
			c.trim().startsWith(`${COOKIE_NAME}-${orgId}=`),
		);
		return cookie ? cookie.split("=")[1] : null;
	},

	set: (orgId: string, projectId: string): void => {
		if (typeof document === "undefined") {
			return;
		}
		const maxAge = 60 * 60 * 24 * 30; // 30 days
		document.cookie = `${COOKIE_NAME}-${orgId}=${projectId}; path=/; max-age=${maxAge}; samesite=lax${
			process.env.NODE_ENV === "production" ? "; secure" : ""
		}`;
	},
};
