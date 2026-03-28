import { isCancellationError, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";
import { logger } from "@llmgateway/logger";

import { getProviderEnv } from "./get-provider-env.js";

import type { BaseMessage, MessageContent } from "@llmgateway/models";

interface GatewayContentFilterContext {
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
	| OpenAIModerationImagePart
	| OpenAIModerationTextPart;

type OpenAIModerationInput = string | OpenAIModerationInputPart[];

interface OpenAIModerationRequest {
	kind: "text" | "image";
	input: OpenAIModerationInput;
}

interface OpenAIModerationResult {
	flagged?: boolean;
	categories?: Record<string, boolean>;
	category_scores?: Record<string, number>;
	category_applied_input_types?: Record<string, string[]>;
}

interface OpenAIModerationResponse {
	id?: string;
	model?: string;
	results?: OpenAIModerationResult[];
}

export interface OpenAIContentFilterCheckResult {
	flagged: boolean;
	model: string;
	upstreamRequestId: string | null;
	results: OpenAIModerationResult[];
}

interface OpenAIContentFilterRequestResult {
	success: boolean;
	response: OpenAIContentFilterCheckResult;
}

const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";
const OPENAI_MODERATION_TIMEOUT_MS = 60_000;
const DEFAULT_OPENAI_MODERATION_SCORE_THRESHOLD = 0.8;

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

			if (part.type === "tool_result" && part.content.trim().length > 0) {
				segments.push(`tool_result: ${part.content.trim()}`);
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
): OpenAIModerationResponse | null {
	if (typeof responseJson !== "object" || responseJson === null) {
		return null;
	}

	const candidate = responseJson as { results?: unknown };
	if (!Array.isArray(candidate.results)) {
		return null;
	}

	return responseJson as OpenAIModerationResponse;
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
	payload: Record<string, unknown>,
) {
	// eslint-disable-next-line no-console
	console.error("gateway_content_filter_error", {
		provider: "openai",
		mode: "openai",
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		...payload,
	});
}

function createFailedOpenAIContentFilterResult(
	upstreamRequestId: string | null = null,
): OpenAIContentFilterCheckResult {
	return {
		flagged: false,
		model: OPENAI_MODERATION_MODEL,
		upstreamRequestId,
		results: [],
	};
}

async function runOpenAIContentFilterRequest(
	request: OpenAIModerationRequest,
	context: GatewayContentFilterContext,
	providerToken: string,
	signal: AbortSignal,
): Promise<OpenAIContentFilterRequestResult> {
	const startTime = Date.now();
	let upstreamResponse: Response;
	let upstreamText: string;

	try {
		upstreamResponse = await fetch(OPENAI_MODERATION_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Client-Request-Id": context.requestId,
				...getProviderHeaders("openai", providerToken),
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

		logModerationError(context, {
			durationMs: Date.now() - startTime,
			inputType: request.kind,
			error: error instanceof Error ? error.message : String(error),
			timeout: isTimeoutError(error),
		});

		return {
			success: false,
			response: createFailedOpenAIContentFilterResult(),
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
	if (!upstreamResponse.ok) {
		logModerationError(context, {
			durationMs: Date.now() - startTime,
			inputType: request.kind,
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			upstreamRequestId,
			response: responseJson,
		});

		return {
			success: false,
			response: createFailedOpenAIContentFilterResult(upstreamRequestId),
		};
	}

	const moderationResponse = parseModerationResponse(responseJson);
	if (!moderationResponse) {
		logModerationError(context, {
			durationMs: Date.now() - startTime,
			inputType: request.kind,
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			upstreamRequestId,
			response: responseJson,
		});

		return {
			success: false,
			response: createFailedOpenAIContentFilterResult(upstreamRequestId),
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
		},
	};
}

export async function checkOpenAIContentFilter(
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal?: AbortSignal,
): Promise<OpenAIContentFilterCheckResult> {
	const startTime = Date.now();
	const moderationRequests = buildOpenAIContentFilterRequests(messages);
	const imageInputs = buildOpenAIContentFilterImageInputs(messages);

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
		const providerEnv = getProviderEnv("openai", {
			advanceRoundRobin: false,
		});
		const moderationResults = await Promise.all(
			moderationRequests.map((request) =>
				runOpenAIContentFilterRequest(
					request,
					context,
					providerEnv.token,
					signal,
				),
			),
		);

		const successfulResults = moderationResults
			.filter((result) => result.success)
			.map((result) => result.response);
		const results = successfulResults.flatMap((result) => result.results);
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
		};
	} catch (error) {
		if (requestSignal?.aborted || isCancellationError(error)) {
			throw error;
		}

		// Fail open for moderation outages so upstream OpenAI moderation issues do
		// not fail customer requests at the gateway layer.
		logModerationError(context, {
			durationMs: Date.now() - startTime,
			error: error instanceof Error ? error.message : String(error),
			timeout: isTimeoutError(error),
		});

		return createFailedOpenAIContentFilterResult();
	}
}
