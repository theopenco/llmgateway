export interface ZdrCompliancePolicy {
	enabled?: boolean;
	zeroDataRetention?: boolean;
}

export const zdrCachingConflictMessage =
	"Zero data retention requires response caching to be disabled for every project. Disable project caching before enabling ZDR, or disable ZDR before enabling project caching.";

export const zdrProviderCachingConflictMessage =
	"Provider prompt caching cannot be enabled while zero data retention is active. Disable ZDR before changing this setting.";

export function isZeroDataRetentionEnabled(
	policy: ZdrCompliancePolicy | null | undefined,
) {
	return policy?.enabled === true && policy.zeroDataRetention === true;
}
