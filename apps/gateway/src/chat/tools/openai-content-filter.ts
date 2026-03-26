import { HTTPException } from "hono/http-exception";

import { createTimeoutSignal, isTimeoutError } from "@/lib/timeout-config.js";

import { getProviderHeaders } from "@llmgateway/actions";

import { getProviderEnv } from "./get-provider-env.js";
import { messagesContainImages } from "./messages-contain-images.js";

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

interface OpenAIModerationResult {
	flagged?: boolean;
	categories?: Record<string, boolean>;
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

const OPENAI_MODERATION_MODEL = "omni-moderation-latest";
const OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations";

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

export function buildOpenAIContentFilterInput(
	messages: BaseMessage[],
): OpenAIModerationInput {
	if (!messagesContainImages(messages)) {
		return messages.map(buildTextSummary).filter(Boolean).join("\n\n");
	}

	const parts: OpenAIModerationInputPart[] = [];

	for (const message of messages) {
		const textSummary = buildTextSummary(message);
		if (textSummary) {
			parts.push({
				type: "text",
				text: textSummary,
			});
		}

		if (!Array.isArray(message.content)) {
			continue;
		}

		for (const part of message.content) {
			const imagePart = toModerationImagePart(part);
			if (imagePart) {
				parts.push(imagePart);
			}
		}
	}

	return parts;
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

function getFlaggedCategories(results: OpenAIModerationResult[]): string[] {
	const categories = new Set<string>();

	for (const result of results) {
		for (const [category, flagged] of Object.entries(result.categories ?? {})) {
			if (flagged) {
				categories.add(category);
			}
		}
	}

	return [...categories];
}

function getOpenAIContentFilterErrorMessage(error: unknown): string {
	if (isTimeoutError(error)) {
		return "Gateway content filter moderation check timed out";
	}

	if (error instanceof Error) {
		return `Gateway content filter moderation check failed: ${error.message}`;
	}

	return `Gateway content filter moderation check failed: ${String(error)}`;
}

function logModerationResult(
	context: GatewayContentFilterContext,
	payload: Record<string, unknown>,
) {
	// eslint-disable-next-line no-console
	console.info("gateway_content_filter", {
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

export async function checkOpenAIContentFilter(
	messages: BaseMessage[],
	context: GatewayContentFilterContext,
	requestSignal?: AbortSignal,
): Promise<OpenAIContentFilterCheckResult> {
	const providerEnv = getProviderEnv("openai");
	const requestBody = {
		model: OPENAI_MODERATION_MODEL,
		input: buildOpenAIContentFilterInput(messages),
	};

	const signal = requestSignal
		? AbortSignal.any([createTimeoutSignal(), requestSignal])
		: createTimeoutSignal();

	let upstreamResponse: Response;
	let upstreamText: string;

	try {
		upstreamResponse = await fetch(OPENAI_MODERATION_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Client-Request-Id": context.requestId,
				...getProviderHeaders("openai", providerEnv.token),
			},
			body: JSON.stringify(requestBody),
			signal,
		});
		upstreamText = await upstreamResponse.text();
	} catch (error) {
		logModerationError(context, {
			error: error instanceof Error ? error.message : String(error),
			timeout: isTimeoutError(error),
		});

		throw new HTTPException(isTimeoutError(error) ? 504 : 502, {
			message: getOpenAIContentFilterErrorMessage(error),
		});
	}

	let responseJson: unknown = null;
	if (upstreamText.length > 0) {
		try {
			responseJson = JSON.parse(upstreamText);
		} catch {
			responseJson = upstreamText;
		}
	}

	if (!upstreamResponse.ok) {
		logModerationError(context, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			upstreamRequestId: upstreamResponse.headers.get("x-request-id"),
			response: responseJson,
		});

		throw new HTTPException(502, {
			message: "Gateway content filter moderation request failed",
		});
	}

	const moderationResponse = parseModerationResponse(responseJson);
	if (!moderationResponse) {
		logModerationError(context, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			upstreamRequestId: upstreamResponse.headers.get("x-request-id"),
			response: responseJson,
		});

		throw new HTTPException(502, {
			message: "Gateway content filter moderation response was invalid",
		});
	}

	const results = moderationResponse.results ?? [];
	const flagged = results.some((result) => result.flagged === true);
	const model = moderationResponse.model ?? OPENAI_MODERATION_MODEL;
	const upstreamRequestId = upstreamResponse.headers.get("x-request-id");

	logModerationResult(context, {
		flagged,
		model,
		upstreamRequestId,
		hasImages: messagesContainImages(messages),
		flaggedCategories: getFlaggedCategories(results),
		results,
	});

	return {
		flagged,
		model,
		upstreamRequestId,
		results,
	};
}
