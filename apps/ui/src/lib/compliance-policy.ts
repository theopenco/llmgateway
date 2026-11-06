import {
	DATA_PROTECTION_POLICY_KEYS,
	projectPolicyToDataProtection,
} from "@llmgateway/models";

import type { ProviderCompliancePolicy } from "@llmgateway/models";

export function hasEnterpriseComplianceRules(
	policy: ProviderCompliancePolicy,
): boolean {
	return Object.entries(policy).some(
		([key, value]) =>
			key !== "enabled" &&
			!(DATA_PROTECTION_POLICY_KEYS as readonly string[]).includes(key) &&
			value !== undefined &&
			value !== null &&
			value !== false &&
			(!Array.isArray(value) || value.length > 0),
	);
}

export function compliancePolicyForSave(
	policy: ProviderCompliancePolicy,
	enterpriseAccess: boolean,
): ProviderCompliancePolicy | undefined {
	if (enterpriseAccess) {
		return policy;
	}
	if (policy.enabled && hasEnterpriseComplianceRules(policy)) {
		return undefined;
	}
	return projectPolicyToDataProtection(policy);
}
