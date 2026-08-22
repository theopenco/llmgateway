import { getOrganizationEnvVariant } from "@llmgateway/models";
import {
	effectivePlanWithoutEnterpriseAccess,
	hasOrganizationEnterpriseAccess,
} from "@llmgateway/shared/enterprise-license";

type OrganizationForVariant =
	| (Exclude<Parameters<typeof getOrganizationEnvVariant>[0], undefined> & {
			id: string;
	  })
	| undefined;

export { hasOrganizationEnterpriseAccess };

export function getLicensedOrganizationEnvVariant(
	organization: OrganizationForVariant,
): ReturnType<typeof getOrganizationEnvVariant> {
	if (!organization) {
		return undefined;
	}

	return getOrganizationEnvVariant({
		...organization,
		plan: effectivePlanWithoutEnterpriseAccess(
			organization.id,
			organization.plan as "free" | "pro" | "enterprise",
		),
	});
}

export function getLicensedOrganizationPlan(
	organizationId: string | null | undefined,
	plan: "free" | "pro" | "enterprise" | null | undefined,
): "free" | "pro" | "enterprise" {
	return effectivePlanWithoutEnterpriseAccess(organizationId, plan);
}
