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
