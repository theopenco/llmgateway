export type GroupBy = "model" | "apiKey" | "user";

export function parseGroupBy(value: string | null): GroupBy {
	return value === "apiKey" || value === "user" ? value : "model";
}

/**
 * The dimension actually rendered. A viewer without the enterprise + owner/admin
 * entitlement asking for `user` falls back to `model`.
 */
export function resolveGroupBy(
	requested: GroupBy,
	canGroupByUser: boolean,
): GroupBy {
	return requested === "user" && !canGroupByUser ? "model" : requested;
}

/**
 * Whether the stale `apiKeyId` filter should be dropped from the URL.
 *
 * Takes the *resolved* dimension, never the requested one. Rewriting the URL for
 * an unentitled viewer would fire a `router.replace` from this page's effect,
 * which runs after `DeveloperRouteGuard`'s and would cancel its redirect to the
 * developer's own dashboard — leaving a developer parked on a project-wide page.
 */
export function shouldStripApiKeyId(
	resolved: GroupBy,
	hasApiKeyId: boolean,
): boolean {
	return resolved !== "model" && hasApiKeyId;
}
