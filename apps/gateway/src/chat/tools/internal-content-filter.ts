import { isCancellationError, isTimeoutError } from "@/lib/timeout-config.js";

import { logger } from "@llmgateway/logger";

import { extractErrorCause } from "./extract-error-cause.js";
import {
	buildOpenAIContentFilterTextInput,
	type GatewayContentFilterContext,
	type OpenAIContentFilterCheckResult,
	type OpenAIModerationResult,
} from "./openai-content-filter.js";

import type { ModerationApiPayload } from "@llmgateway/db";
import type { BaseMessage } from "@llmgateway/models";

export const INTERNAL_MODERATION_MODEL = "internal-classifier";
const INTERNAL_CLASSIFY_PATH = "/v1/classify";
// In-cluster and CPU-bound (a few ms per prompt), so a slow answer means the
// service is unhealthy; fail open quickly instead of holding the request.
const INTERNAL_MODERATION_TIMEOUT_MS = 5_000;
/** The service refuses prompts above this many UTF-8 bytes (HTTP 413). */
export const INTERNAL_MODERATION_MAX_PROMPT_BYTES = 65_536;
const INTERNAL_MODERATION_CONCURRENCY = 8;
/** Category recorded when the service blocks without naming a topic. */
const INTERNAL_BLOCK_CATEGORY = "blocked";

interface InternalClassifyResponse {
	tags?: string[];
	block?: boolean;
	score?: number;
	reasons?: string[];
	truncated?: boolean;
}

export interface InternalContentFilterCheckResult extends OpenAIContentFilterCheckResult {
	/** Some chunks were classified, others failed. */
	partialModerationFailed?: boolean;
}

export function getInternalContentFilterUrl(): string | null {
	const baseUrl = process.env.LLM_CONTENT_FILTER_INTERNAL_URL?.trim();
	return baseUrl ? baseUrl.replace(/\/+$/, "") : null;
}

/** Whether the internal classifier is deployed (its URL is configured). */
export function hasInternalContentFilterCredential(): boolean {
	return getInternalContentFilterUrl() !== null;
}

/**
 * Split text into pieces the service accepts. It refuses an oversized prompt
 * rather than scanning a prefix, so a long conversation is classified chunk by
 * chunk. Splits never cut through a multi-byte character.
 */
export function chunkInternalModerationText(
	text: string,
	maxBytes: number = INTERNAL_MODERATION_MAX_PROMPT_BYTES,
): string[] {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= maxBytes) {
		return text.length > 0 ? [text] : [];
	}

	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let start = 0;
	while (start < bytes.length) {
		let end = Math.min(start + maxBytes, bytes.length);
		// Back off UTF-8 continuation bytes (0b10xxxxxx) to a character start.
		while (end < bytes.length && end > start && (bytes[end]! & 0xc0) === 0x80) {
			end--;
		}
		chunks.push(decoder.decode(bytes.subarray(start, end)));
		start = end;
	}
	return chunks;
}

/**
 * Shape one verdict like a moderation result. `block` is the service's only
 * reject signal and is binary, so its tags are scored 1 and cross every tier's
 * threshold. Tags without `block` are topical and liberal by design: they are
 * kept on the stored response for review but scored nowhere, so they never
 * turn into a violation.
 */
export function toInternalModerationResult(
	response: InternalClassifyResponse,
): OpenAIModerationResult {
	const tags = Array.isArray(response.tags) ? response.tags : [];
	const block = response.block === true;
	const scoredCategories = tags.length > 0 ? tags : [INTERNAL_BLOCK_CATEGORY];
	return {
		flagged: block,
		categories: Object.fromEntries(tags.map((tag) => [tag, block])),
		category_scores: block
			? Object.fromEntries(scoredCategories.map((tag) => [tag, 1]))
			: {},
	};
}

function logInternalError(
	context: GatewayContentFilterContext,
	payload: Record<string, unknown>,
	error?: unknown,
) {
	const logPayload = {
		provider: "internal",
		mode: "internal",
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		...payload,
		...(error instanceof Error
			? {
					error: error.message,
					errorName: error.name,
					...(extractErrorCause(error)
						? { errorCause: extractErrorCause(error) }
						: {}),
				}
			: error !== undefined
				? { error: String(error) }
				: {}),
	};

	if (error instanceof Error) {
		logger.error("gateway_content_filter_error", logPayload, error);
		return;
	}

	logger.error("gateway_content_filter_error", logPayload);
}

async function classifyChunk(
	url: string,
	prompt: string,
	context: GatewayContentFilterContext,
	signal: AbortSignal,
	requestSignal: AbortSignal | undefined,
): Promise<InternalClassifyResponse | null> {
	const startTime = Date.now();
	try {
		const response = await fetch(url, {
			method: "POST",
			redirect: "error",
			headers: {
				"Content-Type": "application/json",
				"X-Request-Id": context.requestId,
			},
			body: JSON.stringify({ prompt }),
			signal,
		});
		const text = await response.text();
		let json: unknown = null;
		if (text.length > 0) {
			try {
				json = JSON.parse(text);
			} catch {
				json = text;
			}
		}

		if (!response.ok || !json || typeof json !== "object") {
			logInternalError(context, {
				durationMs: Date.now() - startTime,
				status: response.status,
				statusText: response.statusText,
				response: json,
			});
			return null;
		}

		const verdict = json as InternalClassifyResponse;
		// A truncated verdict describes a prefix only, so it cannot be trusted.
		if (verdict.truncated === true) {
			logInternalError(context, {
				durationMs: Date.now() - startTime,
				status: response.status,
				truncated: true,
			});
			return null;
		}
		return verdict;
	} catch (error) {
		if (requestSignal?.aborted || isCancellationError(error)) {
			throw error;
		}
		logInternalError(
			context,
			{
				durationMs: Date.now() - startTime,
				timeout: isTimeoutError(error),
			},
			error,
		);
		return null;
	}
}

function emptyResult(): InternalContentFilterCheckResult {
	return {
		flagged: false,
		model: INTERNAL_MODERATION_MODEL,
		upstreamRequestId: null,
		results: [],
		responses: [],
	};
}

/**
 * Score a request's text with the self-hosted classifier and shape the result
 * like a moderation response, so the tiered filter's thresholds, stored
 * evaluations and analytics work unchanged. Text only — callers moderate image
 * parts separately. Fails open like the other classifiers: an outage returns
 * no results rather than failing the customer request.
 */
export async function checkInternalContentFilter(
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal?: AbortSignal,
): Promise<InternalContentFilterCheckResult> {
	const startTime = Date.now();
	const baseUrl = getInternalContentFilterUrl();
	const chunks = chunkInternalModerationText(
		buildOpenAIContentFilterTextInput(messages),
	);
	if (!baseUrl || chunks.length === 0) {
		return emptyResult();
	}

	const url = `${baseUrl}${INTERNAL_CLASSIFY_PATH}`;
	const signal = requestSignal
		? AbortSignal.any([
				AbortSignal.timeout(INTERNAL_MODERATION_TIMEOUT_MS),
				requestSignal,
			])
		: AbortSignal.timeout(INTERNAL_MODERATION_TIMEOUT_MS);

	const verdicts: Array<InternalClassifyResponse | null> = [];
	for (let i = 0; i < chunks.length; i += INTERNAL_MODERATION_CONCURRENCY) {
		verdicts.push(
			...(await Promise.all(
				chunks
					.slice(i, i + INTERNAL_MODERATION_CONCURRENCY)
					.map((chunk) =>
						classifyChunk(url, chunk, context, signal, requestSignal),
					),
			)),
		);
	}

	const succeeded = verdicts.filter(
		(verdict): verdict is InternalClassifyResponse => verdict !== null,
	);
	if (succeeded.length === 0) {
		return emptyResult();
	}

	const results = succeeded.map(toInternalModerationResult);
	const flagged = results.some((result) => result.flagged === true);
	// The raw verdicts (tags, score, reasons) ride along on the stored
	// response so reviewers see what fired, not just the block decision.
	const responses: ModerationApiPayload[] = [
		{
			model: INTERNAL_MODERATION_MODEL,
			results: results.map((result, index) => ({
				...result,
				...succeeded[index],
			})),
		},
	];

	logger.debug("gateway_content_filter", {
		provider: "internal",
		mode: "internal",
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		durationMs: Date.now() - startTime,
		flagged,
		model: INTERNAL_MODERATION_MODEL,
		requestCount: chunks.length,
		failedCount: chunks.length - succeeded.length,
		tags: [...new Set(succeeded.flatMap((verdict) => verdict.tags ?? []))],
	});

	return {
		flagged,
		model: INTERNAL_MODERATION_MODEL,
		upstreamRequestId: null,
		results,
		responses,
		...(succeeded.length < chunks.length
			? { partialModerationFailed: true }
			: {}),
	};
}
