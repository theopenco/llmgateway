/**
 * Whether a provider key may serve a model, per its `allowedModels` restriction.
 *
 * `allowedModels` holds canonical LLM Gateway model ids. NULL or empty means
 * unrestricted — the empty list is deliberately not "no models" because both
 * the API and the dashboard clear the restriction by storing NULL, and a row
 * that can never serve anything is only ever a misconfiguration.
 */
export function providerKeyAllowsModel(
	allowedModels: string[] | null | undefined,
	modelId: string,
): boolean {
	if (!allowedModels || allowedModels.length === 0) {
		return true;
	}
	return allowedModels.includes(modelId);
}
