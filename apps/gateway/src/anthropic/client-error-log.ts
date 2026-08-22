// `/v1/messages` rejects malformed requests before the internal
// `/v1/chat/completions` hop, so the inner handler — which owns all log
// writing — never sees them. Without an explicit log here the caller gets a
// 400 and nothing in their activity feed, which is exactly the case that made
// an OpenAI-format body look like it had silently vanished.
//
// Mirrors the equivalent client-error logging on the images endpoint.

import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { parseApiToken } from "@/lib/extract-api-token.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";

import { shortid } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

import type { Context } from "hono";

interface AnthropicClientErrorLogContext {
	apiKey: NonNullable<Awaited<ReturnType<typeof findApiKeyByToken>>>;
	project: NonNullable<Awaited<ReturnType<typeof findProjectById>>>;
	requestId: string;
	retentionLevel: "retain" | "none";
}

async function resolveLogContext(
	c: Context,
): Promise<AnthropicClientErrorLogContext | null> {
	const token = parseApiToken(c);
	if (!token) {
		return null;
	}

	const apiKey = await findApiKeyByToken(token);
	if (!apiKey || apiKey.status !== "active") {
		return null;
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project || project.status === "deleted") {
		return null;
	}

	const organization = await findOrganizationById(project.organizationId);

	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);
	c.header("x-request-id", requestId);

	return {
		apiKey,
		project,
		requestId,
		retentionLevel: organization?.retentionLevel ?? "none",
	};
}

function readString(raw: unknown, key: string): string | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	const value = (raw as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function readMessages(raw: unknown): any[] {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return [];
	}
	const messages = (raw as Record<string, unknown>).messages;
	return Array.isArray(messages) ? messages : [];
}

/**
 * Writes a `client_error` log row for a `/v1/messages` request rejected before
 * it reached a provider, so the user sees it in their activity feed. Nothing is
 * billed: every cost field is zero and no tokens are recorded.
 *
 * Best-effort — an unauthenticated request (no resolvable API key) has no
 * project to attribute the log to and is skipped, and a logging failure never
 * masks the original 400.
 */
export async function logAnthropicClientError(
	c: Context,
	rawBody: unknown,
	message: string,
	cause: string,
): Promise<void> {
	try {
		const logContext = await resolveLogContext(c);
		if (!logContext) {
			return;
		}

		const requestedModel = readString(rawBody, "model") ?? "unknown";

		await insertLog(
			{
				...createLogEntry({
					requestId: logContext.requestId,
					project: logContext.project,
					apiKey: logContext.apiKey,
					// The request never reached routing, so no provider was chosen and
					// the requested model is the only model information available.
					usedModel: requestedModel,
					usedProvider: "llmgateway",
					requestedModel,
					messages: readMessages(rawBody),
					source: c.req.header("x-source") ?? undefined,
					apiOrigin: "messages",
					customHeaders: extractCustomHeaders(c),
					debugMode: false,
					userAgent: c.req.header("user-agent"),
				}),
				duration: 0,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize: message.length,
				content: null,
				reasoningContent: null,
				finishReason: "client_error",
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				reasoningTokens: null,
				cachedTokens: null,
				cacheWriteTokens: null,
				hasError: true,
				streamed: false,
				canceled: false,
				errorDetails: {
					statusCode: 400,
					statusText: "Bad Request",
					responseText: message,
					cause,
				},
				inputCost: 0,
				outputCost: 0,
				cachedInputCost: 0,
				cacheWriteInputCost: 0,
				requestCost: 0,
				webSearchCost: 0,
				contentFilterCost: null,
				imageInputTokens: null,
				imageOutputTokens: null,
				imageInputCost: null,
				imageOutputCost: null,
				audioInputTokens: null,
				audioInputCost: null,
				cost: 0,
				estimatedCost: false,
				discount: null,
				pricingTier: null,
				requestedServiceTier: null,
				usedServiceTier: null,
				dataStorageCost: calculateDataStorageCost(null, null, null, null),
				cached: false,
				tools: null,
				toolResults: null,
				toolChoice: null,
			},
			{ retentionLevel: logContext.retentionLevel },
		);
	} catch (error) {
		logger.warn("Messages API - failed to log client error", {
			err: toError(error),
		});
	}
}
