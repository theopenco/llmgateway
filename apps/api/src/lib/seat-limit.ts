import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

// Default team-member seat cap per plan tier. An explicit `organization.seats`
// override (set by admins) always takes precedence over these defaults.
export function resolveSeatLimit(
	organizationId: string | null | undefined,
	plan: string | null | undefined,
	seats: number | null | undefined,
): number {
	if (
		plan === "enterprise" &&
		!hasOrganizationEnterpriseAccess(organizationId, plan)
	) {
		return 5;
	}
	if (seats !== null && seats !== undefined) {
		return seats;
	}
	return hasOrganizationEnterpriseAccess(organizationId, plan) ? 100 : 5;
}
