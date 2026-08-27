import { redactedProviderErrorText } from "@/lib/stealth-provider-errors.js";

import { extractErrorCause } from "./extract-error-cause.js";
import { parseTrailingUpstreamError } from "./parse-trailing-upstream-error.js";

interface ErrorWithCode extends Error {
	code?: string;
	cause?: unknown;
}

export interface NormalizeStreamingErrorOptions {
	error: unknown;
	provider: string;
	model: string;
	bufferSnapshot?: string;
	phase: "upstream_connect" | "upstream_read";
	/**
	 * When true, the client-facing payload is scrubbed of every raw upstream
	 * detail so a stealth provider's identity cannot leak through a mid-stream
	 * read fault. The raw error message, the undici `cause` chain (which can
	 * embed the secret host via ENOTFOUND/ECONNREFUSED/TLS errors) and the
	 * buffered upstream body are all dropped; only the gateway-derived status
	 * survives. The internal `log` payload is never redacted — it feeds the
	 * internal-only log columns, consistent with the sibling error branches
	 * (chat.ts:8335 / chat.ts:9254) and redactErrorDetails.
	 */
	redact?: boolean;
}

export interface NormalizedStreamingError {
	/**
	 * True when the failure is an expected upstream-side disconnect (the provider
	 * closed the socket mid-stream, e.g. "terminated: other side closed"), rather
	 * than a gateway-side streaming read fault. Callers use this to avoid logging
	 * the error at server-error severity and to classify it as an upstream error.
	 */
	terminated: boolean;
	client: {
		message: string;
		type: "gateway_error";
		param: null;
		code: "streaming_error";
		responseText?: string;
		details: {
			statusCode: number;
			statusText: string;
			errorName?: string;
			errorCode?: string;
			cause?: string;
		};
	};
	log: {
		message: string;
		type: "streaming_error";
		code: "streaming_error";
		details: {
			statusCode: number;
			statusText: string;
			responseText: string;
			cause?: string;
			name: string;
			errorCode?: string;
			timestamp: string;
			provider: string;
			model: string;
			phase: NormalizeStreamingErrorOptions["phase"];
			bufferSnapshot?: string;
			stack?: string;
		};
	};
}

function getErrorCode(error: unknown): string | undefined {
	if (!(error instanceof Error)) {
		return undefined;
	}

	const directCode =
		typeof (error as ErrorWithCode).code === "string"
			? (error as ErrorWithCode).code
			: undefined;
	if (directCode) {
		return directCode;
	}

	let current = (error as ErrorWithCode).cause;
	for (let depth = 0; depth < 5; depth++) {
		if (!(current instanceof Error)) {
			return undefined;
		}

		if (typeof (current as ErrorWithCode).code === "string") {
			return (current as ErrorWithCode).code;
		}

		current = (current as ErrorWithCode).cause;
	}

	return undefined;
}

function safeStringifyError(error: unknown): string {
	if (error === null || error === undefined) {
		return "Unknown error";
	}

	if (typeof error === "string") {
		return error;
	}

	if (typeof error !== "object") {
		return String(error);
	}

	if (error instanceof Error) {
		return error.message || error.name || "Unknown error";
	}

	const candidate = error as { message?: unknown; error?: unknown };
	if (typeof candidate.message === "string" && candidate.message.length > 0) {
		return candidate.message;
	}
	if (typeof candidate.error === "string" && candidate.error.length > 0) {
		return candidate.error;
	}

	try {
		const serialized = JSON.stringify(error);
		if (serialized && serialized !== "{}") {
			return serialized;
		}
	} catch {
		// fall through to constructor name fallback
	}

	const ctorName =
		(error as { constructor?: { name?: string } }).constructor?.name ??
		"Object";
	return `[unserializable ${ctorName}]`;
}

/**
 * True when the failure is an expected upstream-side socket close (the provider
 * or client closed the connection mid-request, e.g. undici's
 * "terminated: other side closed" / ECONNRESET), rather than a gateway bug.
 * Callers use this to log such disconnects at warn severity instead of raising
 * server-error alerts.
 */
export function isUpstreamTermination(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const normalizedMessage = error.message.trim().toLowerCase();
	const normalizedCause = extractErrorCause(error)?.toLowerCase() ?? "";

	return (
		(error.name === "TypeError" && normalizedMessage === "terminated") ||
		normalizedCause.includes("onhttpsocketclose") ||
		normalizedCause.includes("socket") ||
		normalizedCause.includes("other side closed") ||
		normalizedCause.includes("und_err") ||
		normalizedCause.includes("econnreset")
	);
}

export function normalizeStreamingError(
	options: NormalizeStreamingErrorOptions,
): NormalizedStreamingError {
	const { error, provider, model, bufferSnapshot, phase, redact } = options;

	const errorName =
		error instanceof Error
			? error.name
			: error && typeof error === "object"
				? ((error as { constructor?: { name?: string } }).constructor?.name ??
					"UnknownError")
				: "UnknownError";
	const rawMessage = safeStringifyError(error);
	const cause = extractErrorCause(error);
	const errorCode = getErrorCode(error);

	const terminated = isUpstreamTermination(error);
	// A provider that sheds a stream (e.g. the Gemini API dropping Flex-tier
	// capacity) may write one structured JSON error as a raw body tail before
	// closing the socket. Surface that error's message and status instead of
	// the generic termination text so callers see the real, retryable cause.
	const trailingUpstreamError =
		terminated && bufferSnapshot
			? parseTrailingUpstreamError(bufferSnapshot)
			: null;
	const trailingStatusCode =
		trailingUpstreamError &&
		typeof trailingUpstreamError.code === "number" &&
		trailingUpstreamError.code >= 400 &&
		trailingUpstreamError.code <= 599
			? trailingUpstreamError.code
			: undefined;
	const trailingMessage =
		trailingUpstreamError && typeof trailingUpstreamError.message === "string"
			? trailingUpstreamError.message
			: undefined;
	const statusCode = terminated ? (trailingStatusCode ?? 502) : 500;
	const statusText = terminated
		? "Upstream Stream Terminated"
		: "Streaming Read Error";
	const message = terminated
		? (trailingMessage ??
			"Upstream stream terminated unexpectedly before completion")
		: `Streaming error: ${rawMessage}`;
	const responseText = cause ? `${rawMessage} | cause: ${cause}` : rawMessage;

	const client: NormalizedStreamingError["client"] = redact
		? {
				// Generic, status-only payload: no raw message, no cause chain,
				// no buffered upstream body — none of which may reach a client
				// for a stealth provider.
				message: redactedProviderErrorText(statusCode),
				type: "gateway_error",
				param: null,
				code: "streaming_error",
				responseText: redactedProviderErrorText(statusCode),
				// Status only: errorName / errorCode / cause are all dropped so a stealth
				// provider's failure mode cannot be inferred client-side, matching
				// redactErrorDetails on the sibling branches (chat.ts 8335 / 9254).
				details: {
					statusCode,
					statusText,
				},
			}
		: {
				message,
				type: "gateway_error",
				param: null,
				code: "streaming_error",
				responseText: bufferSnapshot,
				details: {
					statusCode,
					statusText,
					errorName,
					...(errorCode ? { errorCode } : {}),
					...(cause ? { cause } : {}),
				},
			};

	return {
		terminated,
		client,
		log: {
			message: rawMessage,
			type: "streaming_error",
			code: "streaming_error",
			details: {
				statusCode,
				statusText,
				responseText,
				...(cause ? { cause } : {}),
				name: errorName,
				...(errorCode ? { errorCode } : {}),
				timestamp: new Date().toISOString(),
				provider,
				model,
				phase,
				...(bufferSnapshot ? { bufferSnapshot } : {}),
				...(error instanceof Error && error.stack
					? { stack: error.stack }
					: {}),
			},
		},
	};
}
