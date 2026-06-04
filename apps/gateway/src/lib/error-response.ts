// Helpers for rendering gateway-level errors (auth, rate limit, validation,
// timeouts, etc.) in a provider-compatible shape. OpenAI-compatible endpoints
// receive `{ error: { message, type, param, code } }`; the Anthropic
// `/v1/messages` endpoint receives `{ type: "error", error: { type, message } }`.

export interface OpenAIErrorBody {
	error: {
		message: string;
		type: string;
		param: string | null;
		code: string | null;
	};
	/**
	 * @deprecated Backwards-compat mirror of the legacy `{ error, status, message }`
	 * shape. Read `error.message` instead; this top-level field will be removed soon.
	 */
	message: string;
	/**
	 * @deprecated Backwards-compat mirror of the legacy `{ error, status, message }`
	 * shape. Use the HTTP response status instead; this field will be removed soon.
	 */
	status: number;
}

export interface AnthropicErrorBody {
	type: "error";
	error: {
		type: string;
		message: string;
	};
	/**
	 * @deprecated Backwards-compat mirror of the legacy `{ error, status, message }`
	 * shape. Read `error.message` instead; this top-level field will be removed soon.
	 */
	message: string;
	/**
	 * @deprecated Backwards-compat mirror of the legacy `{ error, status, message }`
	 * shape. Use the HTTP response status instead; this field will be removed soon.
	 */
	status: number;
}

// Maps an HTTP status code to the canonical OpenAI `error.type`/`error.code`
// pair. Used as the default when a caller does not provide a more specific one.
export function getOpenAIErrorMeta(status: number): {
	type: string;
	code: string | null;
} {
	switch (status) {
		case 400:
			return { type: "invalid_request_error", code: null };
		case 401:
			return { type: "invalid_request_error", code: "invalid_api_key" };
		case 402:
			return { type: "invalid_request_error", code: "billing_error" };
		case 403:
			return { type: "invalid_request_error", code: "permission_denied" };
		case 404:
			return { type: "invalid_request_error", code: "not_found" };
		case 408:
			return { type: "timeout_error", code: "timeout" };
		case 413:
			return { type: "invalid_request_error", code: "request_too_large" };
		case 415:
			return { type: "invalid_request_error", code: "unsupported_media_type" };
		case 429:
			return { type: "rate_limit_error", code: "rate_limit_exceeded" };
		case 499:
			return { type: "invalid_request_error", code: "request_cancelled" };
		case 504:
			return { type: "timeout_error", code: "timeout" };
		default:
			if (status >= 500) {
				return { type: "api_error", code: null };
			}
			return { type: "invalid_request_error", code: null };
	}
}

// Maps an HTTP status code to the canonical Anthropic `error.type`.
export function getAnthropicErrorType(status: number): string {
	switch (status) {
		case 400:
			return "invalid_request_error";
		case 401:
			return "authentication_error";
		case 402:
			return "billing_error";
		case 403:
			return "permission_error";
		case 404:
			return "not_found_error";
		case 408:
		case 504:
			return "timeout_error";
		case 413:
			return "request_too_large";
		case 429:
			return "rate_limit_error";
		case 529:
			return "overloaded_error";
		default:
			if (status >= 500) {
				return "api_error";
			}
			return "invalid_request_error";
	}
}

export function buildOpenAIErrorBody(opts: {
	message: string;
	status: number;
	type?: string;
	code?: string | null;
	param?: string | null;
}): OpenAIErrorBody {
	const meta = getOpenAIErrorMeta(opts.status);
	return {
		error: {
			message: opts.message,
			type: opts.type ?? meta.type,
			param: opts.param ?? null,
			code: opts.code !== undefined ? opts.code : meta.code,
		},
		// Deprecated legacy fields, kept temporarily for backwards compatibility.
		message: opts.message,
		status: opts.status,
	};
}

export function buildAnthropicErrorBody(opts: {
	message: string;
	status: number;
	type?: string;
}): AnthropicErrorBody {
	return {
		type: "error",
		error: {
			type: opts.type ?? getAnthropicErrorType(opts.status),
			message: opts.message,
		},
		// Deprecated legacy fields, kept temporarily for backwards compatibility.
		message: opts.message,
		status: opts.status,
	};
}
