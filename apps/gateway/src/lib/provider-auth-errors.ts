const INVALID_PROVIDER_CREDENTIAL_PATTERNS = [
	/\binvalid_api_key\b/i,
	/incorrect api key provided/i,
	/api key not valid/i,
	/api key not found/i,
	/please pass a valid api key/i,
];

export function hasInvalidProviderCredentialError(errorText?: string): boolean {
	if (!errorText) {
		return false;
	}

	return INVALID_PROVIDER_CREDENTIAL_PATTERNS.some((pattern) =>
		pattern.test(errorText),
	);
}
