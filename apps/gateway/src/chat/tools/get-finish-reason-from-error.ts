/**
 * Determines the appropriate finish reason based on HTTP status code and error message
 * 5xx status codes indicate upstream provider errors
 * 4xx status codes indicate client/gateway errors
 * Special client errors (like JSON format validation) are classified as client_error
 */
export function getFinishReasonFromError(
	statusCode: number,
	errorText?: string,
): string {
	if (statusCode >= 500) {
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
