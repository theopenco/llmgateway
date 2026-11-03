import {
	getOrganizationEnvVariant,
	type ModelDefinition,
} from "@llmgateway/models";
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

/**
 * Whether the organization may use a model. `enterpriseOnly` models require
 * enterprise access, which is only granted after KYC.
 */
export function canUseModel(
	model: Pick<ModelDefinition, "enterpriseOnly">,
	organizationId: string | null | undefined,
	plan: string | null | undefined,
): boolean {
	return (
		!model.enterpriseOnly ||
		hasOrganizationEnterpriseAccess(organizationId, plan)
	);
}

export function enterpriseOnlyModelMessage(modelId: string): string {
	return `Model ${modelId} is only available on the enterprise plan. Contact us at contact@llmgateway.io to upgrade to enterprise.`;
}
