// Canonical Anthropic `error.type` values per
// https://platform.claude.com/docs/en/api/errors. The docs explicitly note this
// enum will grow over time, so unknown strings on the passthrough path are
// preserved verbatim rather than downgraded to api_error.
const ANTHROPIC_ERROR_TYPES = new Set([
	"invalid_request_error",
	"authentication_error",
	"billing_error",
	"permission_error",
	"not_found_error",
	"request_too_large",
	"rate_limit_error",
	"api_error",
	"timeout_error",
	"overloaded_error",
]);

export function mapInternalErrorTypeToAnthropic(
	internalType?: unknown,
): string {
	if (typeof internalType !== "string") {
		return "api_error";
	}
	switch (internalType) {
		case "client_error":
			return "invalid_request_error";
		case "gateway_error":
			return "authentication_error";
		case "upstream_error":
			return "api_error";
	}
	if (ANTHROPIC_ERROR_TYPES.has(internalType)) {
		return internalType;
	}
	return "api_error";
}

export function buildAnthropicErrorEvent(chunk: unknown): {
	type: "error";
	error: { type: string; message: string };
} {
	if (chunk && typeof chunk === "object") {
		const obj = chunk as Record<string, unknown>;
		// Passthrough: upstream already produced a valid Anthropic error shape.
		// Preserve `inner.type` as-is (the Anthropic enum is documented to grow),
		// only falling back to api_error when the field is missing/non-string.
		if (obj.type === "error" && obj.error && typeof obj.error === "object") {
			const inner = obj.error as Record<string, unknown>;
			return {
				type: "error",
				error: {
					type:
						typeof inner.type === "string" && inner.type
							? inner.type
							: "api_error",
					message:
						typeof inner.message === "string"
							? inner.message
							: JSON.stringify(inner),
				},
			};
		}
		// Wrapped internal shape from /v1/chat/completions error path.
		if (obj.error && typeof obj.error === "object") {
			const inner = obj.error as Record<string, unknown>;
			return {
				type: "error",
				error: {
					type: mapInternalErrorTypeToAnthropic(inner.type ?? inner.code),
					message:
						typeof inner.message === "string"
							? inner.message
							: JSON.stringify(inner),
				},
			};
		}
	}
	return {
		type: "error",
		error: {
			type: "api_error",
			message: typeof chunk === "string" ? chunk : JSON.stringify(chunk),
		},
	};
}
