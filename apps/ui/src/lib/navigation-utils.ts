import type { ReadonlyURLSearchParams } from "next/navigation";

export function buildUrlWithParams(
	basePath: string,
	searchParams: ReadonlyURLSearchParams,
	additionalParams?: Record<string, string | undefined>,
): string {
	const params = new URLSearchParams(searchParams.toString());

	// Add any additional parameters
	if (additionalParams) {
		Object.entries(additionalParams).forEach(([key, value]) => {
			if (value !== undefined) {
				params.set(key, value);
			} else {
				params.delete(key);
			}
		});
	}

	const queryString = params.toString();
	return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * @deprecated Use buildDashboardUrl instead. This function is kept for compatibility with old search param structure.
 */
export function preserveOrgAndProjectParams(
	basePath: string,
	searchParams: ReadonlyURLSearchParams,
): string {
	const params = new URLSearchParams();

	// Only preserve orgId and projectId
	const orgId = searchParams.get("orgId");
	const projectId = searchParams.get("projectId");

	if (orgId) {
		params.set("orgId", orgId);
	}
	if (projectId) {
		params.set("projectId", projectId);
	}

	const queryString = params.toString();
	return queryString ? `${basePath}?${queryString}` : basePath;
}

/**
 * Build a dashboard URL with the new route structure
 */
export function buildDashboardUrl(
	orgId?: string | null,
	projectId?: string | null,
	subPath?: string,
): string {
	if (!orgId || !projectId) {
		// Fallback to base dashboard (will redirect to proper structure)
		return "/dashboard";
	}

	const basePath = `/dashboard/${orgId}/${projectId}`;
	return subPath ? `${basePath}/${subPath}` : basePath;
}

/**
 * Extract orgId and projectId from current pathname
 */
export function extractOrgAndProjectFromPath(pathname: string): {
	orgId: string | null;
	projectId: string | null;
} {
	const match = pathname.match(/^\/dashboard\/([^\/]+)\/([^\/]+)/);
	if (match) {
		return {
			orgId: match[1],
			projectId: match[2],
		};
	}
	return {
		orgId: null,
		projectId: null,
	};
}
