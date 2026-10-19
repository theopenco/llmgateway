import { createLogEntry } from "@/chat/tools/create-log-entry.js";
import { extractCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import {
	findApiKeyByToken,
	findOrganizationCachedById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { getEffectiveRetentionLevel } from "@/lib/compliance.js";
import { parseApiToken } from "@/lib/extract-api-token.js";
import { insertLog } from "@/lib/logs.js";
import { getOrganizationBlockReason } from "@/lib/organization-access.js";

import { shortid } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

import type { ApiOrigin, LogErrorCategory } from "@llmgateway/db";
import type { Context } from "hono";

interface ClientErrorLogContext {
	apiKey: NonNullable<Awaited<ReturnType<typeof findApiKeyByToken>>>;
	project: NonNullable<Awaited<ReturnType<typeof findProjectById>>>;
	retentionLevel: "retain" | "none";
	organization: Awaited<ReturnType<typeof findOrganizationCachedById>>;
}

interface ClientErrorLogOptions {
	apiOrigin: ApiOrigin;
	message: string;
	cause: string;
	statusCode?: number;
	errorCategory?: LogErrorCategory;
}

interface LogGatewayClientErrorOptions extends ClientErrorLogOptions {
	rawBody: unknown;
}

interface LogRealtimeClientErrorOptions extends ClientErrorLogOptions {
	token: string | undefined;
	requestId: string;
	requestedModel: string | undefined;
	source: string | null;
	userAgent: string | undefined;
	customHeaders: Record<string, string>;
}

interface ClientErrorRequest {
	requestId: string;
	requestedModel: string;
	messages: unknown[];
	source: string | undefined;
	customHeaders: Record<string, string>;
	userAgent: string | undefined;
}

async function resolveLogContext(
	token: string | null | undefined,
): Promise<ClientErrorLogContext | null> {
	if (!token) {
		return null;
	}

	const apiKey = await findApiKeyByToken(token);
	if (!apiKey) {
		return null;
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		return null;
	}

	const organization = await findOrganizationCachedById(project.organizationId);

	return {
		apiKey,
		project,
		retentionLevel: getEffectiveRetentionLevel(organization),
		organization,
	};
}

function readField(raw: unknown, key: string): unknown {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return undefined;
	}
	return (raw as Record<string, unknown>)[key];
}

function readString(raw: unknown, key: string): string | undefined {
	const value = readField(raw, key);
	return typeof value === "string" ? value : undefined;
}

function readRequestedModel(
	raw: unknown,
	apiOrigin: ApiOrigin,
): string | undefined {
	if (apiOrigin !== "realtime") {
		return readString(raw, "model");
	}
	// POST /v1/realtime/client_secrets nests the model under `session`.
	const session = readField(raw, "session");
	const transcription = readField(
		readField(readField(session, "audio"), "input"),
		"transcription",
	);
	return readString(session, "model") ?? readString(transcription, "model");
}

function readMessages(raw: unknown, apiOrigin: ApiOrigin): unknown[] {
	const value = readField(
		raw,
		apiOrigin === "responses" ? "input" : "messages",
	);
	if (Array.isArray(value)) {
		return value;
	}
	if (apiOrigin === "responses" && typeof value === "string") {
		return [{ role: "user", content: value }];
	}
	return [];
}

async function writeClientErrorLog(
	logContext: ClientErrorLogContext,
	request: ClientErrorRequest,
	options: ClientErrorLogOptions,
): Promise<void> {
	const statusCode = options.statusCode ?? 400;
	const organization = logContext.organization;
	const blocked = organization && getOrganizationBlockReason(organization);
	const accountCategory =
		blocked?.status === statusCode && blocked.message === options.message
			? organization?.status === "deleted"
				? "account_disabled"
				: "account_review"
			: undefined;

	await insertLog(
		{
			...createLogEntry({
				requestId: request.requestId,
				project: logContext.project,
				apiKey: logContext.apiKey,
				usedModel: request.requestedModel,
				usedProvider: "llmgateway",
				requestedModel: request.requestedModel,
				messages: request.messages,
				source: request.source,
				apiOrigin: options.apiOrigin,
				customHeaders: request.customHeaders,
				debugMode: false,
				userAgent: request.userAgent,
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
			errorCategory: options.errorCategory ?? accountCategory,
			streamed: false,
			canceled: false,
			errorDetails: {
				statusCode,
				statusText: statusCode === 400 ? "Bad Request" : "Request Rejected",
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
			dataStorageCost: "0",
			cached: false,
			tools: null,
			toolResults: null,
			toolChoice: null,
		},
		{ retentionLevel: logContext.retentionLevel },
	);
}

/**
 * Persists a zero-cost client-error row for a request rejected before the
 * normal logging flow. Logging failures never mask the original rejection.
 */
export async function logGatewayClientError(
	c: Context,
	options: LogGatewayClientErrorOptions,
): Promise<void> {
	try {
		const logContext = await resolveLogContext(parseApiToken(c));
		if (!logContext) {
			return;
		}

		const requestId =
			c.res.headers.get("x-request-id") ||
			c.req.header("x-request-id")?.trim() ||
			shortid(40);
		c.header("x-request-id", requestId);

		await writeClientErrorLog(
			logContext,
			{
				requestId,
				requestedModel:
					readRequestedModel(options.rawBody, options.apiOrigin) ?? "unknown",
				messages: readMessages(options.rawBody, options.apiOrigin),
				source: c.req.header("x-source") ?? undefined,
				customHeaders: extractCustomHeaders(c),
				userAgent: c.req.header("user-agent"),
			},
			options,
		);
	} catch (error) {
		logger.warn("Failed to persist gateway client error", {
			apiOrigin: options.apiOrigin,
			err: toError(error),
		});
	}
}

/**
 * {@link logGatewayClientError} for realtime rejections, which happen on the
 * raw upgrade socket or inside an open session, outside of Hono.
 */
export async function logRealtimeClientError(
	options: LogRealtimeClientErrorOptions,
): Promise<void> {
	try {
		const logContext = await resolveLogContext(options.token);
		if (!logContext) {
			return;
		}

		await writeClientErrorLog(
			logContext,
			{
				requestId: options.requestId,
				requestedModel: options.requestedModel ?? "unknown",
				messages: [],
				source: options.source ?? undefined,
				customHeaders: options.customHeaders,
				userAgent: options.userAgent,
			},
			options,
		);
	} catch (error) {
		logger.warn("Failed to persist gateway client error", {
			apiOrigin: options.apiOrigin,
			err: toError(error),
		});
	}
}
