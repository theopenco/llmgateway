import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { getEffectiveRetentionLevel } from "@/lib/compliance.js";
import { parseApiToken } from "@/lib/extract-api-token.js";
import { calculateDataStorageCost, insertLog } from "@/lib/logs.js";

import { shortid } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

import type { ApiOrigin } from "@llmgateway/db";
import type { Context } from "hono";

interface ClientErrorLogContext {
	apiKey: NonNullable<Awaited<ReturnType<typeof findApiKeyByToken>>>;
	project: NonNullable<Awaited<ReturnType<typeof findProjectById>>>;
	requestId: string;
	retentionLevel: "retain" | "none";
}

interface LogGatewayClientErrorOptions {
	apiOrigin: ApiOrigin;
	rawBody: unknown;
	message: string;
	cause: string;
}

async function resolveLogContext(
	c: Context,
): Promise<ClientErrorLogContext | null> {
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
		retentionLevel: getEffectiveRetentionLevel(organization),
	};
}

function readString(raw: unknown, key: string): string | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	const value = (raw as Record<string, unknown>)[key];
	return typeof value === "string" ? value : undefined;
}

function readMessages(raw: unknown, apiOrigin: ApiOrigin): unknown[] {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return [];
	}

	const body = raw as Record<string, unknown>;
	const value = apiOrigin === "responses" ? body.input : body.messages;
	if (Array.isArray(value)) {
		return value;
	}
	if (apiOrigin === "responses" && typeof value === "string") {
		return [{ role: "user", content: value }];
	}
	return [];
}

/**
 * Persists a zero-cost client-error row for a request rejected before the
 * normal chat logging flow. Best-effort: logging never masks the original 400.
 */
export async function logGatewayClientError(
	c: Context,
	options: LogGatewayClientErrorOptions,
): Promise<void> {
	try {
		const logContext = await resolveLogContext(c);
		if (!logContext) {
			return;
		}

		const requestedModel = readString(options.rawBody, "model") ?? "unknown";

		await insertLog(
			{
				...createLogEntry({
					requestId: logContext.requestId,
					project: logContext.project,
					apiKey: logContext.apiKey,
					usedModel: requestedModel,
					usedProvider: "llmgateway",
					requestedModel,
					messages: readMessages(options.rawBody, options.apiOrigin),
					source: c.req.header("x-source") ?? undefined,
					apiOrigin: options.apiOrigin,
					customHeaders: extractCustomHeaders(c),
					debugMode: false,
					userAgent: c.req.header("user-agent"),
				}),
				duration: 0,
				timeToFirstToken: null,
				timeToFirstReasoningToken: null,
				responseSize: options.message.length,
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
					responseText: options.message,
					cause: options.cause,
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
		logger.warn("Failed to persist gateway client error", {
			apiOrigin: options.apiOrigin,
			err: toError(error),
		});
	}
}
