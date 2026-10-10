import { isRecord } from "@/lib/message-metadata";

/**
 * Derive a user-facing message and HTTP status from a gateway/provider
 * failure. The AI SDK surfaces upstream failures as errors carrying the raw
 * `responseBody`, whose OpenAI-compatible envelope holds the gateway's
 * detailed message; prefer that over the SDK's generic Error message.
 */
export function describeGatewayError(
	error: unknown,
	fallbackMessage: string,
): { message: string; status: number } {
	const status =
		isRecord(error) && typeof error.status === "number" ? error.status : 500;

	let message = error instanceof Error ? error.message : fallbackMessage;

	if (isRecord(error) && typeof error.responseBody === "string") {
		const detail = readErrorMessage(error.responseBody);
		if (detail) {
			message = detail;
		}
	}

	return { message: message.trim() || fallbackMessage, status };
}

// Gateway errors use OpenAI's `{ error: { message } }` envelope; some routes
// return a bare `{ message }` or `{ error: "..." }` instead.
function readErrorMessage(responseBody: string): string | undefined {
	let body: unknown;
	try {
		body = JSON.parse(responseBody);
	} catch {
		return undefined;
	}
	if (!isRecord(body)) {
		return undefined;
	}
	if (typeof body.message === "string") {
		return body.message;
	}
	if (typeof body.error === "string") {
		return body.error;
	}
	if (isRecord(body.error) && typeof body.error.message === "string") {
		return body.error.message;
	}
	return undefined;
}
