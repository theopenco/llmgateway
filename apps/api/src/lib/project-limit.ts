import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

// Org-wide cap on non-deleted projects. An explicit `organization.projectLimit`
// override (set by admins) always takes precedence over these plan defaults.
export function resolveProjectLimit(
	organizationId: string | null | undefined,
	plan: string | null | undefined,
	projectLimit: number | null | undefined,
): number {
	if (
		plan === "enterprise" &&
		!hasOrganizationEnterpriseAccess(organizationId, plan)
	) {
		return 10;
	}
	if (projectLimit !== null && projectLimit !== undefined) {
		return projectLimit;
	}
	return hasOrganizationEnterpriseAccess(organizationId, plan) ? 250 : 10;
}
