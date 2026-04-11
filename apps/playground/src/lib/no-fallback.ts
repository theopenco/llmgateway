export const NO_FALLBACK_LOCAL_STORAGE_KEY = "llmgateway_no_fallback";

export function shouldDisableFallback(modelId: string): boolean {
	const isProviderSpecific = modelId.includes("/");
	const localStorageOverride =
		typeof window !== "undefined" &&
		localStorage.getItem(NO_FALLBACK_LOCAL_STORAGE_KEY) === "true";

	return isProviderSpecific || localStorageOverride;
}
