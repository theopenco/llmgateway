export interface ZdrCompliancePolicy {
	enabled?: boolean;
	zeroDataRetention?: boolean;
}

interface ZdrOrganization {
	providerCompliancePolicy?: ZdrCompliancePolicy | null;
}

export const zdrCachingConflictMessage =
	"Zero data retention requires response caching to be disabled for every project. Disable project caching before enabling ZDR, or disable ZDR before enabling project caching.";

export const zdrProviderCachingConflictMessage =
	"Provider prompt caching cannot be enabled while zero data retention is active. Disable ZDR before changing this setting.";

export function isZeroDataRetentionEnabled(
	organization: ZdrOrganization | null | undefined,
) {
	if (!organization) {
		return false;
	}
	const policy = organization.providerCompliancePolicy;
	return policy?.enabled === true && policy.zeroDataRetention === true;
}
