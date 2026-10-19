import { isTimeoutError } from "@/lib/timeout-config.js";

import { logger } from "@llmgateway/logger";

import { extractErrorCause } from "./extract-error-cause.js";

import type { GatewayContentFilterContext } from "./openai-content-filter.js";
import type {
	ContentFilterClassifier,
	ContentFilterModerationError,
	ContentFilterModerationErrorKind,
} from "@llmgateway/db";

/** Longest message or upstream body kept on a log line or stored evaluation. */
export const CONTENT_FILTER_ERROR_MESSAGE_MAX_LENGTH = 200;

interface ErrorWithCode extends Error {
	code?: unknown;
	cause?: unknown;
}

interface UpstreamErrorBody {
	error?: { code?: unknown; message?: unknown; type?: unknown };
	message?: unknown;
}

export interface ContentFilterErrorInput {
	source: ContentFilterClassifier;
	inputType?: "text" | "image";
	/** HTTP status of a response that came back; unset when the call threw. */
	status?: number;
	/** Parsed JSON body, or the raw text when it was not JSON. */
	response?: unknown;
	/** The thrown value, when the call threw. */
	error?: unknown;
	/** The check ran out of its time budget without a thrown TimeoutError. */
	timeout?: boolean;
	/** A 2xx body that was not a moderation response. */
	badResponse?: boolean;
	/** Message to use when nothing better can be derived. */
	message?: string;
}

function truncate(text: string): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized.length > CONTENT_FILTER_ERROR_MESSAGE_MAX_LENGTH
		? `${normalized.slice(0, CONTENT_FILTER_ERROR_MESSAGE_MAX_LENGTH - 1)}…`
		: normalized;
}

/**
 * A loggable version of an upstream body. Error pages from a CDN run to
 * several kilobytes of HTML; only their title says anything.
 */
export function summarizeUpstreamBody(body: unknown): unknown {
	if (typeof body !== "string") {
		return body;
	}
	const title = /<title>([^<]*)<\/title>/i.exec(body)?.[1];
	if (title) {
		return truncate(title);
	}
	return truncate(body);
}

function getErrorCode(error: unknown): string | undefined {
	const visited = new Set<unknown>();
	let current: unknown = error;
	for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
		if (visited.has(current)) {
			return undefined;
		}
		visited.add(current);
		const code = (current as ErrorWithCode).code;
		if (typeof code === "string" && code.length > 0) {
			return code;
		}
		current = (current as ErrorWithCode).cause;
	}
	return undefined;
}

function upstreamMessage(response: unknown): string | undefined {
	if (typeof response === "string") {
		const summary = summarizeUpstreamBody(response);
		return typeof summary === "string" && summary.length > 0
			? summary
			: undefined;
	}
	if (typeof response !== "object" || response === null) {
		return undefined;
	}
	const body = response as UpstreamErrorBody;
	const message = body.error?.message ?? body.message;
	return typeof message === "string" && message.length > 0
		? truncate(message)
		: undefined;
}

function upstreamCode(response: unknown): string | undefined {
	if (typeof response !== "object" || response === null) {
		return undefined;
	}
	const code = (response as UpstreamErrorBody).error?.code;
	return typeof code === "string" && code.length > 0 ? code : undefined;
}

/**
 * Reduce a failed moderation call to a kind the dashboard can count and a
 * message short enough to store.
 */
export function classifyContentFilterError(
	input: ContentFilterErrorInput,
): ContentFilterModerationError {
	const { source, inputType, status, response, error } = input;
	let kind: ContentFilterModerationErrorKind;
	let code: string | undefined;
	let message: string | undefined = input.message;

	if (input.timeout || isTimeoutError(error)) {
		kind = "timeout";
		message ??= "moderation call timed out";
	} else if (error !== undefined) {
		kind = error instanceof TypeError ? "network" : "unexpected";
		code = getErrorCode(error);
		if (error instanceof Error) {
			const cause = extractErrorCause(error);
			message ??= cause ? `${error.message}: ${cause}` : error.message;
		} else {
			message ??= String(error);
		}
	} else if (status !== undefined && status >= 500) {
		kind = "upstream_5xx";
		code = upstreamCode(response);
		message ??= upstreamMessage(response) ?? `HTTP ${status}`;
	} else if (status !== undefined && status >= 400) {
		kind = "upstream_4xx";
		code = upstreamCode(response);
		message ??= upstreamMessage(response) ?? `HTTP ${status}`;
	} else if (input.badResponse || status !== undefined) {
		kind = "bad_response";
		message ??= upstreamMessage(response) ?? "unexpected moderation response";
	} else {
		kind = "unexpected";
		message ??= "moderation failed";
	}

	return {
		source,
		kind,
		...(inputType ? { inputType } : {}),
		...(status !== undefined ? { status } : {}),
		...(code ? { code } : {}),
		message: truncate(message),
	};
}

/**
 * A 4xx is the request's fault (an image format the classifier does not take,
 * a corrupt upload) and expected at some rate; everything else is the
 * classifier or the network failing and still deserves an alert.
 */
export function contentFilterErrorLogLevel(
	error: Pick<ContentFilterModerationError, "kind">,
): "warn" | "error" {
	return error.kind === "upstream_4xx" ? "warn" : "error";
}

/**
 * Log one failed moderation call, at a level chosen by its kind. `payload`
 * carries the call-specific fields; the upstream body in it is summarized.
 * `level` overrides the kind's default (a partial timeout is only a warning).
 */
export function logContentFilterError(
	mode: string,
	provider: string,
	context: GatewayContentFilterContext,
	error: ContentFilterModerationError,
	payload: Record<string, unknown>,
	thrown?: unknown,
	level: "warn" | "error" = contentFilterErrorLogLevel(error),
) {
	const logPayload = {
		provider,
		mode,
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		...payload,
		...("response" in payload
			? { response: summarizeUpstreamBody(payload.response) }
			: {}),
		errorKind: error.kind,
		...(error.code ? { errorCode: error.code } : {}),
		...(thrown instanceof Error
			? {
					error: thrown.message,
					errorName: thrown.name,
					...(extractErrorCause(thrown)
						? { errorCause: extractErrorCause(thrown) }
						: {}),
				}
			: {
					error: error.message,
					...(thrown !== undefined ? { errorName: typeof thrown } : {}),
				}),
	};

	if (thrown instanceof Error) {
		logger[level]("gateway_content_filter_error", logPayload, thrown);
		return;
	}
	logger[level]("gateway_content_filter_error", logPayload);
}
