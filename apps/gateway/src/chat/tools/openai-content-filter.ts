import {
	findManagedProviderKey,
	hasManagedProviderCredential,
} from "@/lib/cached-queries.js";
import { isCancellationError, isTimeoutError } from "@/lib/timeout-config.js";

import {
	getProviderDefaultBaseUrl,
	getProviderHeaders,
	readProviderKey,
} from "@llmgateway/actions";
import { logger } from "@llmgateway/logger";
import { getProviderEnvValue } from "@llmgateway/models";

import { extractErrorCause } from "./extract-error-cause.js";
import { getProviderEnv } from "./get-provider-env.js";

import type { ModerationApiPayload } from "@llmgateway/db";
import type { BaseMessage, MessageContent } from "@llmgateway/models";

interface GatewayContentFilterContext {
	requestId: string;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
}

interface ErrorWithCode extends Error {
	code?: string;
	cause?: unknown;
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

interface OpenAIModerationResult {
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
}

interface OpenAIContentFilterRequestResult {
	success: boolean;
	response: OpenAIContentFilterCheckResult;
}

const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const OPENAI_MODERATION_PATH = "/v1/moderations";
const OPENAI_MODERATION_TIMEOUT_MS = 60_000;
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
	payload: Record<string, unknown>,
	error?: unknown,
) {
	const logPayload = {
		provider: "openai",
		mode: "openai",
		requestId: context.requestId,
		organizationId: context.organizationId,
		projectId: context.projectId,
		apiKeyId: context.apiKeyId,
		...payload,
		...buildModerationErrorDetails(error),
	};

	if (error instanceof Error) {
		logger.error("gateway_content_filter_error", logPayload, error);
		return;
	}

	logger.error("gateway_content_filter_error", logPayload);
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

	const visited = new Set<Error>([error]);
	let current = (error as ErrorWithCode).cause;
	for (let depth = 0; depth < 5; depth++) {
		if (!(current instanceof Error) || visited.has(current)) {
			return undefined;
		}
		visited.add(current);

		if (typeof (current as ErrorWithCode).code === "string") {
			return (current as ErrorWithCode).code;
		}

		current = (current as ErrorWithCode).cause;
	}

	return undefined;
}

function buildModerationErrorDetails(error: unknown): Record<string, string> {
	if (!(error instanceof Error)) {
		return {
			error: String(error),
			errorName:
				error === null
					? "NullThrownValue"
					: typeof error === "undefined"
						? "UndefinedThrownValue"
						: typeof error,
		};
	}

	const errorCause = extractErrorCause(error);
	const errorCode = getErrorCode(error);

	return {
		error: error.message,
		errorName: error.name,
		...(errorCause ? { errorCause } : {}),
		...(errorCode ? { errorCode } : {}),
	};
}

function createFailedOpenAIContentFilterResult(
	upstreamRequestId: string | null = null,
): OpenAIContentFilterCheckResult {
	return {
		flagged: false,
		model: OPENAI_MODERATION_MODEL,
		upstreamRequestId,
		results: [],
		responses: [],
	};
}

interface ContentFilterCredential {
	providerToken: string;
	moderationUrl: string;
}

/**
 * The OpenAI credential the moderation call runs on. A managed credential
 * supersedes the env vars for its provider entirely, so once one exists the
 * environment is never read — and a provider whose managed credentials cannot
 * serve the call has no env key left to fall back to. The base URL follows
 * the same credential, so a proxied deployment moderates through its proxy.
 */
async function resolveContentFilterCredential(): Promise<ContentFilterCredential> {
	const defaultBaseUrl = getProviderDefaultBaseUrl("openai") ?? "";
	if (await hasManagedProviderCredential("openai")) {
		const managedKey = await findManagedProviderKey("openai", {
			selectionScope: OPENAI_MODERATION_MODEL,
		});
		if (!managedKey) {
			throw new Error(
				"No managed credential available for provider: openai (content filter)",
			);
		}
		return {
			providerToken: readProviderKey(managedKey),
			moderationUrl: `${managedKey.config?.baseUrl ?? defaultBaseUrl}${OPENAI_MODERATION_PATH}`,
		};
	}
	const env = getProviderEnv("openai", { advanceRoundRobin: false });
	const baseUrl =
		getProviderEnvValue("openai", "baseUrl", env.configIndex) ?? defaultBaseUrl;
	return {
		providerToken: env.token,
		moderationUrl: `${baseUrl}${OPENAI_MODERATION_PATH}`,
	};
}

async function runOpenAIContentFilterRequest(
	request: OpenAIModerationRequest,
	context: GatewayContentFilterContext,
	credential: ContentFilterCredential,
	signal: AbortSignal,
): Promise<OpenAIContentFilterRequestResult> {
	const startTime = Date.now();
	let upstreamResponse: Response;
	let upstreamText: string;

	try {
		upstreamResponse = await fetch(credential.moderationUrl, {
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

		logModerationError(
			context,
			{
				durationMs: Date.now() - startTime,
				inputType: request.kind,
				timeout: isTimeoutError(error),
			},
			error,
		);

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
			responses: [moderationResponse],
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
		// Gateway-internal safety filter: always uses the base credential, never
		// the enterprise-plan env override. Managed credentials replace the env
		// vars for their provider, so once OpenAI has one the moderation call
		// uses it and never reads `LLM_OPENAI_API_KEY`; when none can serve it,
		// this throws and the filter fails open below.
		const credential = await resolveContentFilterCredential();
		const moderationResults = await Promise.all(
			moderationRequests.map((request) =>
				runOpenAIContentFilterRequest(request, context, credential, signal),
			),
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
		};
	} catch (error) {
		if (requestSignal?.aborted || isCancellationError(error)) {
			throw error;
		}

		// Fail open for moderation outages so upstream OpenAI moderation issues do
		// not fail customer requests at the gateway layer.
		logModerationError(
			context,
			{
				durationMs: Date.now() - startTime,
				timeout: isTimeoutError(error),
			},
			error,
		);

		return createFailedOpenAIContentFilterResult();
	}
}
