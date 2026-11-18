import { isCancellationError, isTimeoutError } from "@/lib/timeout-config.js";

import { logger } from "@llmgateway/logger";
import { INTERNAL_CLASSIFIER_MODEL } from "@llmgateway/shared";

import {
	classifyContentFilterError,
	logContentFilterError,
} from "./content-filter-error.js";
import {
	buildLatestTurnModerationText,
	buildOpenAIContentFilterTextInput,
	chunkModerationText,
	type GatewayContentFilterContext,
	type OpenAIContentFilterCheckResult,
	type OpenAIModerationResult,
} from "./openai-content-filter.js";

import type {
	ModerationApiPayload,
	ContentFilterModerationError,
} from "@llmgateway/db";
import type { BaseMessage } from "@llmgateway/models";
import type { ContentFilterInternalScope } from "@llmgateway/shared";

const INTERNAL_CLASSIFY_PATH = "/v1/classify";
// In-cluster and CPU-bound (a few ms per prompt), so a slow answer means the
// service is unhealthy; fail open quickly instead of holding the request.
const INTERNAL_MODERATION_TIMEOUT_MS = 5_000;
/** The service refuses prompts above this many UTF-8 bytes (HTTP 413). */
export const INTERNAL_MODERATION_MAX_PROMPT_BYTES = 65_536;
const INTERNAL_MODERATION_CONCURRENCY = 8;
/** Category recorded when the service blocks without naming a topic. */
const INTERNAL_BLOCK_CATEGORY = "blocked";

export interface InternalContentFilterCheckResult extends OpenAIContentFilterCheckResult {
	/** Some chunks were classified, others failed. */
	partialModerationFailed?: boolean;
	/** Classify calls attempted: one per chunk of the text read. */
	requestCount: number;
}

interface InternalClassifyResponse {
	tags?: string[];
	block?: boolean;
	score?: number;
	reasons?: string[];
	truncated?: boolean;
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
	// `signal:*` entries are inputs to the rules, not rules.
	const rules = Array.isArray(response.reasons)
		? response.reasons.filter(
				(reason) => typeof reason === "string" && !reason.startsWith("signal:"),
			)
		: [];
	return {
		flagged: block,
		categories: Object.fromEntries(tags.map((tag) => [tag, block])),
		category_scores: block
			? Object.fromEntries(scoredCategories.map((tag) => [tag, 1]))
			: {},
		// Set on every block, even empty: its tags must never stand in for it.
		...(block ? { rules } : {}),
	};
}

function logInternalError(
	context: GatewayContentFilterContext,
	error: ContentFilterModerationError,
	payload: Record<string, unknown>,
	thrown?: unknown,
	level?: "error" | "warn",
) {
	logContentFilterError(
		"internal",
		"internal",
		context,
		error,
		payload,
		thrown,
		level,
	);
}

/**
 * One classify call. Null when the shared time budget ran out: the caller
 * logs that once for the whole check.
 */
async function classifyPrompt(
	url: string,
	prompt: string,
	context: GatewayContentFilterContext,
	signal: AbortSignal,
	requestSignal: AbortSignal | undefined,
): Promise<
	| { verdict: InternalClassifyResponse }
	| { error: ContentFilterModerationError }
	| null
> {
	const startTime = Date.now();
	try {
		const response = await fetch(url, {
			method: "POST",
			redirect: "error",
			// Prompt only: the classifier keeps no audit log, so it needs no
			// request or organization ids.
			headers: { "Content-Type": "application/json" },
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
			const error = classifyContentFilterError({
				source: "internal",
				inputType: "text",
				status: response.status,
				response: json,
				badResponse: response.ok,
			});
			logInternalError(context, error, {
				durationMs: Date.now() - startTime,
				status: response.status,
				statusText: response.statusText,
				response: json,
			});
			return { error };
		}

		const verdict = json as InternalClassifyResponse;
		// A truncated verdict describes a prefix only, so it cannot be trusted.
		if (verdict.truncated === true) {
			const error = classifyContentFilterError({
				source: "internal",
				inputType: "text",
				status: response.status,
				badResponse: true,
				message: "classifier truncated the prompt",
			});
			logInternalError(context, error, {
				durationMs: Date.now() - startTime,
				status: response.status,
				truncated: true,
			});
			return { error };
		}
		return { verdict };
	} catch (thrown) {
		if (requestSignal?.aborted || isCancellationError(thrown)) {
			throw thrown;
		}
		// The budget is shared across chunks; the caller logs it once.
		if (isTimeoutError(thrown)) {
			return null;
		}
		const error = classifyContentFilterError({
			source: "internal",
			inputType: "text",
			error: thrown,
		});
		logInternalError(
			context,
			error,
			{ durationMs: Date.now() - startTime, timeout: false },
			thrown,
		);
		return { error };
	}
}

function emptyResult(
	requestCount = 0,
	errors: ContentFilterModerationError[] = [],
): InternalContentFilterCheckResult {
	return {
		flagged: false,
		model: INTERNAL_CLASSIFIER_MODEL,
		upstreamRequestId: null,
		results: [],
		responses: [],
		errors,
		requestCount,
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
	scope: ContentFilterInternalScope = "full",
): Promise<InternalContentFilterCheckResult> {
	const startTime = Date.now();
	const baseUrl = getInternalContentFilterUrl();
	// Newest chunk first: when the time budget runs out, what goes unscreened
	// is the oldest history rather than the turn being sent now.
	const prompts =
		scope === "latest_turn"
			? [
					buildLatestTurnModerationText(
						messages,
						INTERNAL_MODERATION_MAX_PROMPT_BYTES,
					),
				].filter(Boolean)
			: chunkModerationText(
					buildOpenAIContentFilterTextInput(messages),
					INTERNAL_MODERATION_MAX_PROMPT_BYTES,
				).reverse();
	if (!baseUrl || prompts.length === 0) {
		return emptyResult();
	}

	const url = `${baseUrl}${INTERNAL_CLASSIFY_PATH}`;
	const timeoutSignal = AbortSignal.timeout(INTERNAL_MODERATION_TIMEOUT_MS);
	const signal = requestSignal
		? AbortSignal.any([timeoutSignal, requestSignal])
		: timeoutSignal;

	const outcomes: Array<Awaited<ReturnType<typeof classifyPrompt>>> = [];
	for (let i = 0; i < prompts.length; i += INTERNAL_MODERATION_CONCURRENCY) {
		requestSignal?.throwIfAborted();
		if (timeoutSignal.aborted) {
			break;
		}
		outcomes.push(
			...(await Promise.all(
				prompts
					.slice(i, i + INTERNAL_MODERATION_CONCURRENCY)
					.map((prompt) =>
						classifyPrompt(url, prompt, context, signal, requestSignal),
					),
			)),
		);
	}

	const succeeded = outcomes.flatMap((outcome) =>
		outcome && "verdict" in outcome ? [outcome.verdict] : [],
	);
	const errors = outcomes.flatMap((outcome) =>
		outcome && "error" in outcome ? [outcome.error] : [],
	);
	if (timeoutSignal.aborted && succeeded.length < prompts.length) {
		// Newest chunks are screened first, so a partial result still covers
		// the turn being sent; only a check with no verdict at all is an error.
		const timeoutError = classifyContentFilterError({
			source: "internal",
			inputType: "text",
			timeout: true,
		});
		errors.push(timeoutError);
		logInternalError(
			context,
			timeoutError,
			{
				durationMs: Date.now() - startTime,
				timeout: true,
				scope,
				requestCount: prompts.length,
				failedCount: prompts.length - succeeded.length,
				skippedCount: prompts.length - outcomes.length,
			},
			undefined,
			succeeded.length > 0 ? "warn" : "error",
		);
	}
	if (succeeded.length === 0) {
		return emptyResult(outcomes.length, errors);
	}

	const results = succeeded.map(toInternalModerationResult);
	const flagged = results.some((result) => result.flagged === true);
	// The raw verdicts (tags, score, reasons, fingerprint) ride along on the
	// stored response so reviewers see what fired, not just the block
	// decision; the admin classifier export reads them from there.
	const responses: ModerationApiPayload[] = [
		{
			model: INTERNAL_CLASSIFIER_MODEL,
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
		model: INTERNAL_CLASSIFIER_MODEL,
		scope,
		requestCount: prompts.length,
		failedCount: prompts.length - succeeded.length,
		tags: [...new Set(succeeded.flatMap((verdict) => verdict.tags ?? []))],
	});

	return {
		flagged,
		model: INTERNAL_CLASSIFIER_MODEL,
		upstreamRequestId: null,
		results,
		responses,
		errors,
		requestCount: outcomes.length,
		...(succeeded.length < prompts.length
			? { partialModerationFailed: true }
			: {}),
	};
}
