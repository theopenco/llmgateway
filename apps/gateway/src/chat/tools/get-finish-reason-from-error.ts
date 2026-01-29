/**
 * Determines the appropriate finish reason based on HTTP status code and error message
 * 5xx status codes indicate upstream provider errors
 * 429 status codes indicate upstream rate limiting (treated as upstream error)
 * 404 status codes indicate model/endpoint not found at provider (treated as upstream error)
 * Other 4xx status codes indicate client/gateway errors
 * Special client errors (like JSON format validation) are classified as client_error
 */
export function getFinishReasonFromError(
	statusCode: number,
	errorText?: string,
): string {
	if (statusCode >= 500) {
		return "upstream_error";
	}

	// 429 is a rate limit from the upstream provider, not a client error
	if (statusCode === 429) {
		return "upstream_error";
	}

	// 404 from upstream provider indicates model/endpoint not found at provider
	if (statusCode === 404) {
		return "upstream_error";
	}

	// 403 from upstream provider indicates authentication/authorization issue at provider
	if (statusCode === 403) {
		return "upstream_error";
	}

	// zai content filter
	if (
		errorText?.includes(
			"System detected potentially unsafe or sensitive content in input or generation",
		)
	) {
		return "client_error";
	}

	// Provider API key not found - treat as upstream error for health/uptime purposes
	if (errorText?.includes("API Key not found. Please pass a valid API key.")) {
		return "upstream_error";
	}

	// Check for specific client validation errors from providers
	if (statusCode === 400 && errorText) {
		// OpenAI JSON format validation error
		if (
			errorText.includes("'messages' must contain") &&
			errorText.includes("the word 'json'")
		) {
			return "client_error";
		}
	}

	return "gateway_error";
}
