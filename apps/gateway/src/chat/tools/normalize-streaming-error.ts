import { extractErrorCause } from "./extract-error-cause.js";

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
}

export interface NormalizedStreamingError {
	client: {
		message: string;
		type: "gateway_error";
		param: null;
		code: "streaming_error";
		responseText?: string;
		details: {
			statusCode: number;
			statusText: string;
			errorName: string;
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

function isUpstreamTermination(error: unknown, cause?: string): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const normalizedMessage = error.message.trim().toLowerCase();
	const normalizedCause = cause?.toLowerCase() ?? "";

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
	const { error, provider, model, bufferSnapshot, phase } = options;

	const errorName = error instanceof Error ? error.name : "UnknownError";
	const rawMessage =
		error instanceof Error ? error.message : String(error ?? "Unknown error");
	const cause = extractErrorCause(error);
	const errorCode = getErrorCode(error);

	const terminated = isUpstreamTermination(error, cause);
	const statusCode = terminated ? 502 : 500;
	const statusText = terminated
		? "Upstream Stream Terminated"
		: "Streaming Read Error";
	const message = terminated
		? "Upstream stream terminated unexpectedly before completion"
		: `Streaming error: ${rawMessage}`;
	const responseText = cause ? `${rawMessage} | cause: ${cause}` : rawMessage;

	return {
		client: {
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
		},
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
