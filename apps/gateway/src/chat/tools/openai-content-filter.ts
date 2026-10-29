import { setTimeout as sleep } from "node:timers/promises";

import { isCancellationError, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { logger } from "@llmgateway/logger";

import {
	hasContentFilterCredential,
	resolveContentFilterCredential,
	type ContentFilterCredential,
} from "./content-filter-credential.js";
import {
	classifyContentFilterError,
	logContentFilterError,
} from "./content-filter-error.js";

import type {
	ModerationApiPayload,
	ContentFilterModerationError,
} from "@llmgateway/db";
import type { BaseMessage, MessageContent } from "@llmgateway/models";

export interface GatewayContentFilterContext {
	requestId: string;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
}

interface OpenAIModerationImagePart {
	type: "image_url";
	image_url: {
		url: string;
	};
}

interface OpenAIModerationTextPart {
	type: "text";
	text: string;
}

type OpenAIModerationInputPart =
	OpenAIModerationImagePart | OpenAIModerationTextPart;

type OpenAIModerationInput = string | OpenAIModerationInputPart[];

interface OpenAIModerationRequest {
	kind: "text" | "image";
	input: OpenAIModerationInput;
}

export interface OpenAIModerationResult {
	flagged?: boolean;
	categories?: Record<string, boolean>;
	category_scores?: Record<string, number>;
	category_applied_input_types?: Record<string, string[]>;
}

export interface OpenAIContentFilterCheckResult {
	flagged: boolean;
	model: string;
	upstreamRequestId: string | null;
	results: OpenAIModerationResult[];
	responses: ModerationApiPayload[];
	/** Moderation calls that failed, in call order. */
	errors: ContentFilterModerationError[];
}

interface OpenAIContentFilterRequestResult {
	success: boolean;
	response: OpenAIContentFilterCheckResult;
}

type OpenAIModerationAttempt =
	| { success: true; response: OpenAIContentFilterCheckResult }
	| {
			success: false;
			error: ContentFilterModerationError;
			payload: Record<string, unknown>;
			thrown?: unknown;
			upstreamRequestId: string | null;
	  };

const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const OPENAI_MODERATION_PATH = "/v1/moderations";
const OPENAI_MODERATION_TIMEOUT_MS = 60_000;
const OPENAI_MODERATION_MAX_ATTEMPTS = 2;
const OPENAI_MODERATION_RETRY_DELAY_MS = 100;
const DEFAULT_OPENAI_MODERATION_SCORE_THRESHOLD = 0.75;

function getOpenAIModerationScoreThreshold(): number {
	const envValue = process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD;

	if (!envValue || envValue.trim() === "") {
		return DEFAULT_OPENAI_MODERATION_SCORE_THRESHOLD;
	}

	const parsedThreshold = Number(envValue);
	if (
		!Number.isFinite(parsedThreshold) ||
		parsedThreshold < 0 ||
		parsedThreshold > 1
	) {
		return DEFAULT_OPENAI_MODERATION_SCORE_THRESHOLD;
	}

	return parsedThreshold;
}

function buildTextSummary(message: BaseMessage): string | null {
	const segments: string[] = [];

	if (typeof message.content === "string") {
		if (message.content.trim().length > 0) {
			segments.push(message.content.trim());
		}
	} else if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (part.type === "text" && part.text.trim().length > 0) {
				segments.push(part.text.trim());
				continue;
			}

			if (part.type === "tool_use") {
				segments.push(
					`tool_use ${part.name}: ${JSON.stringify(part.input ?? {})}`,
				);
				continue;
			}

			if (part.type === "tool_result") {
				// The content is a block array when a client-side tool search
				// answered with tool_reference blocks; there is no user text in
				// those, so only the string form is worth screening.
				const text =
					typeof part.content === "string" ? part.content.trim() : "";
				if (text.length > 0) {
					segments.push(`tool_result: ${text}`);
				}
			}
		}
	}

	if (message.tool_calls && message.tool_calls.length > 0) {
		segments.push(`tool_calls: ${JSON.stringify(message.tool_calls)}`);
	}

	if (message.tool_call_id) {
		segments.push(`tool_call_id: ${message.tool_call_id}`);
	}

	if (segments.length === 0) {
		return null;
	}

	return `${message.role}: ${segments.join("\n")}`;
}

function toModerationImagePart(
	part: MessageContent,
): OpenAIModerationImagePart | null {
	if (part.type === "image_url") {
		return {
			type: "image_url",
			image_url: {
				url: part.image_url.url,
			},
		};
	}

	if (part.type === "image") {
		return {
			type: "image_url",
			image_url: {
				url: `data:${part.source.media_type};base64,${part.source.data}`,
			},
		};
	}

	return null;
}

export function buildOpenAIContentFilterTextInput(
	messages: BaseMessage[],
): string {
	return messages.map(buildTextSummary).filter(Boolean).join("\n\n");
}

export function buildOpenAIContentFilterImageInputs(
	messages: BaseMessage[],
): OpenAIModerationInput[] {
	const inputs: OpenAIModerationInput[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}

		for (const part of message.content) {
			const imagePart = toModerationImagePart(part);
			if (imagePart) {
				inputs.push([imagePart]);
			}
		}
	}

	return inputs;
}

function buildOpenAIContentFilterRequests(
	messages: BaseMessage[],
): OpenAIModerationRequest[] {
	const requests: OpenAIModerationRequest[] = [];
	const textInput = buildOpenAIContentFilterTextInput(messages);
	const imageInputs = buildOpenAIContentFilterImageInputs(messages);

	if (textInput.length > 0) {
		requests.push({
			kind: "text",
			input: textInput,
		});
	}

	for (const imageInput of imageInputs) {
		requests.push({
			kind: "image",
			input: imageInput,
		});
	}

	return requests;
}

function parseModerationResponse(
	responseJson: unknown,
): ModerationApiPayload | null {
	if (typeof responseJson !== "object" || responseJson === null) {
		return null;
	}

	const candidate = responseJson as { results?: unknown };
	if (!Array.isArray(candidate.results)) {
		return null;
	}

	return responseJson as ModerationApiPayload;
}

function getMatchedCategoryScores(result: OpenAIModerationResult): string[] {
	return Object.entries(result.category_scores ?? {})
		.filter(([, score]) => score > getOpenAIModerationScoreThreshold())
		.map(([category]) => category);
}

function isOpenAIModerationResultFlagged(
	result: OpenAIModerationResult,
): boolean {
	return getMatchedCategoryScores(result).length > 0;
}

function getFlaggedCategories(results: OpenAIModerationResult[]): string[] {
	const categories = new Set<string>();

	for (const result of results) {
		for (const category of getMatchedCategoryScores(result)) {
			categories.add(category);
		}
	}

	return [...categories];
}

function logModerationResult(
	context: GatewayContentFilterContext,
	payload: Record<string, unknown>,
) {
	logger.debug("gateway_content_filter", {
		provider: "openai",
		mode: "openai",
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		...payload,
	});
}

function logModerationError(
	context: GatewayContentFilterContext,
	error: ContentFilterModerationError,
	payload: Record<string, unknown>,
	thrown?: unknown,
	level?: "warn" | "error",
) {
	logContentFilterError(
		"openai",
		"openai",
		context,
		error,
		payload,
		thrown,
		level,
	);
}

/**
 * A connection reset or 5xx is usually gone on the next try. A timeout has
 * spent the budget, and a 4xx or malformed body would fail again.
 */
function isRetryableModerationError(
	error: ContentFilterModerationError,
): boolean {
	return error.kind === "network" || error.kind === "upstream_5xx";
}

function createFailedOpenAIContentFilterResult(
	upstreamRequestId: string | null = null,
	errors: ContentFilterModerationError[] = [],
): OpenAIContentFilterCheckResult {
	return {
		flagged: false,
		model: OPENAI_MODERATION_MODEL,
		upstreamRequestId,
		results: [],
		responses: [],
		errors,
	};
}

/**
 * Whether a moderation call could be made at all. Lets deployments without an
 * OpenAI credential skip the tiered filter instead of failing open per request.
 */
export async function hasOpenAIContentFilterCredential(): Promise<boolean> {
	return await hasContentFilterCredential("openai");
}

/**
 * One moderation call, retried once on a transient failure. The retried
 * attempt only warns; a failure that survives the retry logs at its kind's
 * level.
 */
async function runOpenAIContentFilterRequest(
	request: OpenAIModerationRequest,
	context: GatewayContentFilterContext,
	credential: ContentFilterCredential,
	signal: AbortSignal,
): Promise<OpenAIContentFilterRequestResult> {
	for (let attempt = 1; ; attempt++) {
		const result = await attemptOpenAIContentFilterRequest(
			request,
			context,
			credential,
			signal,
		);
		if (result.success) {
			return result;
		}

		const retrying =
			attempt < OPENAI_MODERATION_MAX_ATTEMPTS &&
			isRetryableModerationError(result.error);
		logModerationError(
			context,
			result.error,
			{ ...result.payload, attempt, retrying },
			result.thrown,
			retrying ? "warn" : undefined,
		);
		if (!retrying) {
			return {
				success: false,
				response: createFailedOpenAIContentFilterResult(
					result.upstreamRequestId,
					[result.error],
				),
			};
		}
		// No abort signal: the next fetch rejects at once if the budget ran out.
		await sleep(OPENAI_MODERATION_RETRY_DELAY_MS);
	}
}

async function attemptOpenAIContentFilterRequest(
	request: OpenAIModerationRequest,
	context: GatewayContentFilterContext,
	credential: ContentFilterCredential,
	signal: AbortSignal,
): Promise<OpenAIModerationAttempt> {
	const startTime = Date.now();
	let upstreamResponse: Response;
	let upstreamText: string;

	try {
		upstreamResponse = await fetch(credential.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Client-Request-Id": context.requestId,
				...getProviderHeaders("openai", credential.providerToken, {
					requestId: context.requestId,
				}),
			},
			body: JSON.stringify({
				model: OPENAI_MODERATION_MODEL,
				input: request.input,
			}),
			signal,
		});
		upstreamText = await upstreamResponse.text();
	} catch (error) {
		if (signal.aborted || isCancellationError(error)) {
			throw error;
		}

		return {
			success: false,
			error: classifyContentFilterError({
				source: "openai",
				inputType: request.kind,
				error,
			}),
			payload: {
				durationMs: Date.now() - startTime,
				inputType: request.kind,
				timeout: isTimeoutError(error),
			},
			thrown: error,
			upstreamRequestId: null,
		};
	}

	let responseJson: unknown = null;
	if (upstreamText.length > 0) {
		try {
			responseJson = JSON.parse(upstreamText);
		} catch {
			responseJson = upstreamText;
		}
	}

	const upstreamRequestId = upstreamResponse.headers.get("x-request-id");
	const moderationResponse = upstreamResponse.ok
		? parseModerationResponse(responseJson)
		: null;
	if (!moderationResponse) {
		return {
			success: false,
			error: classifyContentFilterError({
				source: "openai",
				inputType: request.kind,
				status: upstreamResponse.status,
				response: responseJson,
				badResponse: upstreamResponse.ok,
			}),
			payload: {
				durationMs: Date.now() - startTime,
				inputType: request.kind,
				status: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
				upstreamRequestId,
				response: responseJson,
			},
			upstreamRequestId,
		};
	}

	return {
		success: true,
		response: {
			flagged: (moderationResponse.results ?? []).some((result) =>
				isOpenAIModerationResultFlagged(result),
			),
			model: moderationResponse.model ?? OPENAI_MODERATION_MODEL,
			upstreamRequestId,
			results: moderationResponse.results ?? [],
			responses: [moderationResponse],
			errors: [],
		},
	};
}

export async function checkOpenAIContentFilter(
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal?: AbortSignal,
	options?: {
		/**
		 * Input kinds to moderate. Defaults to both. The Jev classifier is text
		 * only, so it delegates just the image parts here.
		 */
		kinds?: ("text" | "image")[];
	},
): Promise<OpenAIContentFilterCheckResult> {
	const startTime = Date.now();
	const kinds = options?.kinds ?? ["text", "image"];
	const moderationRequests = buildOpenAIContentFilterRequests(messages).filter(
		(request) => kinds.includes(request.kind),
	);
	const imageInputs = kinds.includes("image")
		? buildOpenAIContentFilterImageInputs(messages)
		: [];

	if (moderationRequests.length === 0) {
		logModerationResult(context, {
			durationMs: Date.now() - startTime,
			flagged: false,
			model: OPENAI_MODERATION_MODEL,
			upstreamRequestId: null,
			hasImages: false,
			requestCount: 0,
			imageRequestCount: 0,
			flaggedCategories: [],
			results: [],
		});

		return createFailedOpenAIContentFilterResult();
	}

	const signal = requestSignal
		? AbortSignal.any([
				AbortSignal.timeout(OPENAI_MODERATION_TIMEOUT_MS),
				requestSignal,
			])
		: AbortSignal.timeout(OPENAI_MODERATION_TIMEOUT_MS);

	try {
		// Gateway-internal safety filter: always uses the base credential, never
		// the enterprise-plan env override. Managed credentials replace the env
		// vars for their provider, so once OpenAI has one the moderation call
		// uses it and never reads `LLM_OPENAI_API_KEY`; when none can serve it,
		// this throws and the filter fails open below.
		const credential = await resolveContentFilterCredential(
			"openai",
			OPENAI_MODERATION_PATH,
			OPENAI_MODERATION_MODEL,
		);
		const moderationResults = await Promise.all(
			moderationRequests.map((request) =>
				runOpenAIContentFilterRequest(request, context, credential, signal),
			),
		);

		const errors = moderationResults.flatMap(
			(result) => result.response.errors,
		);
		const successfulResults = moderationResults
			.filter((result) => result.success)
			.map((result) => result.response);
		const results = successfulResults.flatMap((result) => result.results);
		const responses = successfulResults.flatMap((result) => result.responses);
		const flagged = successfulResults.some((result) => result.flagged);
		const model = successfulResults[0]?.model ?? OPENAI_MODERATION_MODEL;
		const upstreamRequestId =
			successfulResults.find(
				(result) => result.flagged && result.upstreamRequestId !== null,
			)?.upstreamRequestId ??
			successfulResults.find((result) => result.upstreamRequestId !== null)
				?.upstreamRequestId ??
			null;

		logModerationResult(context, {
			durationMs: Date.now() - startTime,
			flagged,
			model,
			upstreamRequestId,
			hasImages: imageInputs.length > 0,
			requestCount: moderationRequests.length,
			imageRequestCount: imageInputs.length,
			flaggedCategories: getFlaggedCategories(results),
			results,
		});

		return {
			flagged,
			model,
			upstreamRequestId,
			results,
			responses,
			errors,
		};
	} catch (error) {
		if (requestSignal?.aborted || isCancellationError(error)) {
			throw error;
		}

		// Fail open for moderation outages so upstream OpenAI moderation issues do
		// not fail customer requests at the gateway layer.
		const moderationError = classifyContentFilterError({
			source: "openai",
			error,
		});
		logModerationError(
			context,
			moderationError,
			{
				durationMs: Date.now() - startTime,
				timeout: isTimeoutError(error),
			},
			error,
		);

		return createFailedOpenAIContentFilterResult(null, [moderationError]);
	}
}
