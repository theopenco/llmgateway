import { getRegionScopedDefaultRegion } from "@llmgateway/models";

export function narrowManagedKeysToRegion<
	Key extends { region?: string | null },
>(keys: Key[], provider: string, region: string | undefined): Key[] {
	if (region) {
		const pinned = keys.filter((key) => key.region === region);
		return pinned.length > 0 ? pinned : keys.filter((key) => !key.region);
	}

	const regionAgnostic = keys.filter((key) => !key.region);
	if (regionAgnostic.length > 0) {
		return regionAgnostic;
	}

	const defaultRegion = getRegionScopedDefaultRegion(provider);
	return defaultRegion
		? keys.filter((key) => key.region === defaultRegion)
		: [];
}
