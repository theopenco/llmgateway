export function formatUsedModelForDisplay(
	usedProvider: string,
	usedInternalModel: string,
	customProviderName?: string,
	usedRegion?: string,
): string {
	const providerPrefix =
		usedProvider === "custom" && customProviderName
			? customProviderName
			: usedProvider;

	const base = `${providerPrefix}/${usedInternalModel}`;
	return usedRegion ? `${base}:${usedRegion}` : base;
}
