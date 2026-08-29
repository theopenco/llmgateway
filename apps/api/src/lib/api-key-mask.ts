export function readApiKeyMask(apiKey: { tokenMasked: string | null }): string {
	if (!apiKey.tokenMasked) {
		throw new Error("API key mask is missing");
	}

	return apiKey.tokenMasked;
}
