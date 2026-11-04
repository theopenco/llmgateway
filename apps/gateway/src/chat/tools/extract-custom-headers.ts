export function extractCustomHeaders(c: any): Record<string, string> {
	return customHeadersFrom(c.req.raw.headers.entries());
}

export function customHeadersFrom(
	headers: Iterable<[string, string | string[] | undefined]>,
): Record<string, string> {
	const customHeaders: Record<string, string> = {};
	for (const [key, value] of headers) {
		if (value !== undefined && key.toLowerCase().startsWith("x-llmgateway-")) {
			const suffix = key.toLowerCase().substring("x-llmgateway-".length);
			customHeaders[suffix] = Array.isArray(value) ? value.join(", ") : value;
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
