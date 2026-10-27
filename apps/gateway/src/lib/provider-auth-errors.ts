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

// Denials of one optional feature, answered with a 401 although the key is
// valid for everything else.
const FEATURE_ACCESS_DENIED_PATTERNS = [
	// Bedrock Web Search without the bedrock-websearch:* IAM permissions.
	/web search is not authorized for this identity/i,
];

export function hasFeatureAccessDeniedError(errorText?: string): boolean {
	if (!errorText) {
		return false;
	}

	return FEATURE_ACCESS_DENIED_PATTERNS.some((pattern) =>
		pattern.test(errorText),
	);
}
