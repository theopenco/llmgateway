import { isOrganizationAdmin } from "@llmgateway/shared/organization-roles";

import type { Organization } from "@/lib/types";

export function findFallbackOrganization(
	organizations: Pick<Organization, "id" | "role" | "credits">[],
) {
	return (
		organizations.find(
			(organization) =>
				isOrganizationAdmin(organization.role) &&
				Number(organization.credits) > 0,
		) ??
		organizations.find(
			(organization) => !isOrganizationAdmin(organization.role),
		)
	);
}
