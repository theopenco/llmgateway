import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Error types `@ai-sdk/gateway` knows how to classify. Anything else falls
 * through to `GatewayInternalServerError` on the client, which loses the
 * distinction between "your request was wrong" and "we broke", so the mapping
 * is driven off the HTTP status the inner chat completions call produced.
 */
type GatewayErrorType =
	| "authentication_error"
	| "forbidden"
	| "invalid_request_error"
	| "model_not_found"
	| "rate_limit_exceeded"
	| "failed_dependency"
	| "internal_server_error";

export function gatewayErrorTypeForStatus(status: number): GatewayErrorType {
	switch (status) {
		case 401:
			return "authentication_error";
		case 402:
		case 403:
		case 410:
			return "forbidden";
		case 404:
			return "model_not_found";
		case 429:
			return "rate_limit_exceeded";
		case 424:
			return "failed_dependency";
		default:
			return status >= 500 ? "internal_server_error" : "invalid_request_error";
	}
}

export interface GatewayErrorBody {
	error: {
		message: string;
		type: GatewayErrorType;
		param?: unknown;
	};
}

export function buildGatewayErrorBody({
	status,
	message,
	modelId,
}: {
	status: number;
	message: string;
	modelId?: string;
}): GatewayErrorBody {
	const type = gatewayErrorTypeForStatus(status);
	return {
		error: {
			message,
			type,
			// `GatewayModelNotFoundError` reads the offending id out of `param`.
			...(type === "model_not_found" && modelId ? { param: { modelId } } : {}),
		},
	};
}

/**
 * Extracts the human-readable message from the inner `/v1/chat/completions`
 * error envelope, falling back to the raw body when it is not JSON (upstream
 * proxies occasionally return HTML).
 */
export function extractInnerErrorMessage(
	body: string,
	fallback: string,
): string {
	try {
		const parsed = JSON.parse(body) as {
			error?: { message?: unknown };
			message?: unknown;
		};
		if (typeof parsed.error?.message === "string") {
			return parsed.error.message;
		}
		if (typeof parsed.message === "string") {
			return parsed.message;
		}
	} catch {
		// not JSON
	}
	return body || fallback;
}

export function asStatusCode(status: number): ContentfulStatusCode {
	return (
		status >= 400 && status <= 599 ? status : 500
	) as ContentfulStatusCode;
}
