import { PRO_PLAN_INCLUDED_PROJECTS } from "@llmgateway/shared";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

// Org-wide cap on non-deleted projects. An explicit `organization.projectLimit`
// override (set by admins) always takes precedence over these plan defaults.
// Seat-based Pro subscribers buy extra projects on top of the included
// allowance; legacy flat-fee Pro (no `proSeats`) keeps the included allowance.
export function resolveProjectLimit(
	organizationId: string | null | undefined,
	plan: string | null | undefined,
	projectLimit: number | null | undefined,
	pro?: {
		proSeats: number | null;
		proExtraProjects: number | null;
	},
): number {
	if (
		plan === "enterprise" &&
		!hasOrganizationEnterpriseAccess(organizationId, plan)
	) {
		return PRO_PLAN_INCLUDED_PROJECTS;
	}
	if (projectLimit !== null && projectLimit !== undefined) {
		return projectLimit;
	}
	if (hasOrganizationEnterpriseAccess(organizationId, plan)) {
		return 250;
	}
	if (plan === "pro" && pro?.proSeats !== null && pro?.proSeats !== undefined) {
		return PRO_PLAN_INCLUDED_PROJECTS + (pro.proExtraProjects ?? 0);
	}
	return PRO_PLAN_INCLUDED_PROJECTS;
}
