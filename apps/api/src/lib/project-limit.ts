// Org-wide cap on non-deleted projects. An explicit `organization.projectLimit`
// override (set by admins) always takes precedence over these plan defaults.
export function resolveProjectLimit(
	plan: string | null | undefined,
	projectLimit: number | null | undefined,
): number {
	if (projectLimit !== null && projectLimit !== undefined) {
		return projectLimit;
	}
	return plan === "enterprise" ? 250 : 10;
}
