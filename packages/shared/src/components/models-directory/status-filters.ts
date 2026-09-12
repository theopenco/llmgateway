import {
	getMappingStatus,
	isMappingDeactivated,
	type ModelMappingStatus,
} from "@/deactivation";

export type StatusFilter = ModelMappingStatus | null;

interface StatusVisibilityMapping {
	deprecatedAt?: Date | string | null;
	deactivatedAt?: Date | string | null;
	blockedReasons?: string[] | null;
}

interface StatusVisibilityOptions {
	status: StatusFilter;
	showDeactivated: boolean;
	eligibleOnly?: boolean;
}

/**
 * Whether a provider mapping may render in the directory.
 *
 * With a status selected, the mapping must be exactly of that status. With
 * none selected the legacy default applies: past-deprecated and
 * past-deactivated mappings are hidden (the legacy `?deactivated=true` toggle
 * un-hides the latter and, for backwards compatibility, overrides any status
 * — old links keep their original unhide-everything meaning).
 */
export function isVisibleMapping(
	mapping: StatusVisibilityMapping,
	{ status, showDeactivated, eligibleOnly }: StatusVisibilityOptions,
	now: Date = new Date(),
): boolean {
	const effectiveStatus: StatusFilter = showDeactivated ? null : status;
	if (effectiveStatus) {
		if (getMappingStatus(mapping, now) !== effectiveStatus) {
			return false;
		}
	} else {
		if (mapping.deprecatedAt && new Date(mapping.deprecatedAt) <= now) {
			return false;
		}
		if (!showDeactivated && isMappingDeactivated(mapping, now)) {
			return false;
		}
	}
	if (eligibleOnly && mapping.blockedReasons?.length) {
		return false;
	}
	return true;
}
