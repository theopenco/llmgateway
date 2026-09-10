export function getDefaultProviderMapping<T extends { region?: string | null }>(
	mappings: T[],
): T {
	return (
		mappings.find((mapping) => mapping.region === "global") ??
		mappings.find((mapping) => !mapping.region) ??
		mappings[0]
	);
}
