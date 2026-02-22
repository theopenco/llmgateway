/**
 * Determines the appropriate finish reason based on HTTP status code and error message
 * 5xx status codes indicate upstream provider errors
 * 429 status codes indicate upstream rate limiting (treated as upstream error)
 * 404 status codes indicate model/endpoint not found at provider (treated as upstream error)
 * 401/403 status codes indicate authentication/authorization issues (gateway configuration errors)
 * Other 4xx status codes indicate client/gateway errors
 * Special client errors (like JSON format validation) are classified as client_error
 *
 * Note: Error classification is separate from health tracking. The health tracking system
 * (api-key-health.ts) independently handles 401/403 errors for uptime routing purposes
 * by permanently blacklisting keys with these status codes.
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

	// Azure OpenAI content filter (ResponsibleAIPolicyViolation)
	if (errorText?.includes("ResponsibleAIPolicyViolation")) {
		return "content_filter";
	}

	// zai content filter
	if (
		errorText?.includes(
			"System detected potentially unsafe or sensitive content in input or generation",
		)
	) {
		return "client_error";
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
