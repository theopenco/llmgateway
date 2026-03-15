import type { Route } from "next";
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
): Route {
	if (!orgId || !projectId) {
		// Fallback to base dashboard (will redirect to proper structure)
		return "/dashboard";
	}

	const basePath = `/dashboard/${orgId}/${projectId}`;
	return subPath ? (`${basePath}/${subPath}` as Route) : (basePath as Route);
}

/**
 * Build an organization-scoped URL (without project ID)
 */
export function buildOrgUrl(orgId?: string | null, subPath?: string): string {
	if (!orgId) {
		// Fallback to base dashboard (will redirect to proper structure)
		return "/dashboard";
	}

	const basePath = `/dashboard/${orgId}`;
	return subPath ? `${basePath}/${subPath}` : basePath;
}

/**
 * Extract orgId and projectId from current pathname
 */
export function extractOrgAndProjectFromPath(pathname: string): {
	orgId: string | null;
	projectId: string | null;
} {
	// Org-only pages (all under /org/ path)
	const orgOnlyMatch = pathname.match(/^\/dashboard\/([^/]+)\/org\//);
	if (orgOnlyMatch) {
		return {
			orgId: orgOnlyMatch[1],
			projectId: null,
		};
	}

	// Project pages
	const projectMatch = pathname.match(/^\/dashboard\/([^/]+)\/([^/]+)/);
	if (projectMatch) {
		return {
			orgId: projectMatch[1],
			projectId: projectMatch[2],
		};
	}

	// Just org ID (e.g., /dashboard/org-123)
	const orgMatch = pathname.match(/^\/dashboard\/([^/]+)$/);
	if (orgMatch) {
		return {
			orgId: orgMatch[1],
			projectId: null,
		};
	}

	return {
		orgId: null,
		projectId: null,
	};
}
