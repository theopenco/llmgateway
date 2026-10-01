/**
 * Extracts X-LLMGateway-* headers from the request context
 * Returns a key-value object where keys are the suffix after x-llmgateway- and values are header values
 */
export function extractCustomHeaders(c: any): Record<string, string> {
	const customHeaders: Record<string, string> = {};

	// Get all headers from the raw request
	const headers = c.req.raw.headers;

	// Iterate through all headers
	for (const [key, value] of headers.entries()) {
		if (key.toLowerCase().startsWith("x-llmgateway-")) {
			// Extract the suffix after x-llmgateway- and store with lowercase key
			const suffix = key.toLowerCase().substring("x-llmgateway-".length);
			customHeaders[suffix] = value;
		}
	}

	return customHeaders;
}

// Set by the gateway itself on the internal hop; never taken from the caller.
const INTERNAL_SIGNAL_HEADERS = new Set(["x-llmgateway-thinking-type"]);

/**
 * X-LLMGateway-* metadata headers to carry across an internal `app.request()`
 * hop, so the inner handler logs them as it would on a direct call.
 */
export function forwardedCustomHeaders(
	headers: Headers,
): Record<string, string> {
	const forwarded: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		const name = key.toLowerCase();
		if (
			name.startsWith("x-llmgateway-") &&
			!INTERNAL_SIGNAL_HEADERS.has(name)
		) {
			forwarded[name] = value;
		}
	}
	return forwarded;
}
