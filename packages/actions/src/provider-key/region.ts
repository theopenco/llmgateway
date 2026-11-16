import {
	getRegionScopedDefaultRegion,
	getEffectiveCredentialRegion,
} from "@llmgateway/models";

export function narrowManagedKeysToRegion<
	Key extends { region?: string | null },
>(keys: Key[], provider: string, region: string | undefined): Key[] {
	// A provider with no global region (Alibaba) serves every credential from
	// one region: an unpinned one runs in its default region, so it matches
	// only that region rather than standing in for every other one.
	const defaultRegion = getRegionScopedDefaultRegion(provider);
	if (defaultRegion) {
		const target = region ?? defaultRegion;
		return keys.filter(
			(key) => getEffectiveCredentialRegion(provider, key.region) === target,
		);
	}

	if (region) {
		const pinned = keys.filter((key) => key.region === region);
		return pinned.length > 0 ? pinned : keys.filter((key) => !key.region);
	}

	return keys.filter((key) => !key.region);
}
