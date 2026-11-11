const RESEND_API_URL = "https://api.resend.com";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ResendCall {
	apiKey: string;
	method: "GET" | "POST" | "PATCH";
	path: string;
	body?: unknown;
	timeoutMs?: number;
}

/**
 * One call to Resend's REST API, for what the pinned SDK predates: contact
 * topics, segments, and broadcasts addressed to a segment and topic.
 */
export async function resendFetch(call: ResendCall): Promise<Response> {
	const hasBody = call.body !== undefined;
	return await fetch(`${RESEND_API_URL}${call.path}`, {
		method: call.method,
		headers: {
			Authorization: `Bearer ${call.apiKey}`,
			...(hasBody && { "Content-Type": "application/json" }),
		},
		body: hasBody ? JSON.stringify(call.body) : undefined,
		signal: AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
	});
}
