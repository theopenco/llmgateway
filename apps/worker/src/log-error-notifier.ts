import { UnifiedFinishReason } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

export interface LogErrorNotification {
	id: string;
	requestId: string;
	createdAt: Date;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
	requestedModel: string;
	requestedProvider: string | null;
	usedModel: string;
	usedProvider: string;
	unifiedFinishReason: string | null;
	finishReason: string | null;
	errorDetails: {
		statusCode: number;
		statusText: string;
		responseText: string;
		cause?: string;
	} | null;
	traceId: string | null;
	retried: boolean | null;
}

interface LogErrorDiscordOptions {
	log: LogErrorNotification;
	webhookEnvVar: string;
	errorKind: string;
}

export interface LogErrorHandling {
	errorKind: string;
	logLevel: "info" | "warn";
	shouldNotifyDiscord: boolean;
}

interface DiscordEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

interface DiscordWebhookPayload {
	embeds: Array<{
		title: string;
		description?: string;
		color: number;
		fields: DiscordEmbedField[];
		timestamp: string;
	}>;
}

const DEFAULT_APP_URL = "https://llmgateway.io";
const DEFAULT_GOOGLE_CLOUD_PROJECT = "llmgatewayio";
const DISCORD_FIELD_LIMIT = 1024;

export function getLogErrorHandling(
	log: Pick<LogErrorNotification, "unifiedFinishReason">,
): LogErrorHandling {
	switch (log.unifiedFinishReason) {
		case UnifiedFinishReason.CLIENT_ERROR:
			return {
				errorKind: "Client Error",
				logLevel: "info",
				shouldNotifyDiscord: false,
			};
		case UnifiedFinishReason.CONTENT_FILTER:
			return {
				errorKind: "Content Filter",
				logLevel: "info",
				shouldNotifyDiscord: false,
			};
		case UnifiedFinishReason.GATEWAY_ERROR:
			return {
				errorKind: "Gateway Error",
				logLevel: "warn",
				shouldNotifyDiscord: true,
			};
		case UnifiedFinishReason.UPSTREAM_ERROR:
			return {
				errorKind: "Provider Error",
				logLevel: "warn",
				shouldNotifyDiscord: true,
			};
		default:
			return {
				errorKind: "Log Error",
				logLevel: "warn",
				shouldNotifyDiscord: false,
			};
	}
}

export function buildLogErrorContext(
	log: LogErrorNotification,
	errorKind: string,
): Record<string, string | number | boolean | null | undefined> {
	return {
		errorKind,
		logId: log.id,
		requestId: log.requestId,
		traceId: log.traceId,
		organizationId: log.organizationId,
		projectId: log.projectId,
		apiKeyId: log.apiKeyId,
		usedProvider: log.usedProvider,
		usedModel: log.usedModel,
		requestedProvider: log.requestedProvider,
		requestedModel: log.requestedModel,
		statusCode: log.errorDetails?.statusCode,
		statusText: log.errorDetails?.statusText,
		unifiedFinishReason: log.unifiedFinishReason,
		finishReason: log.finishReason,
		retried: log.retried,
	};
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function toInlineCode(value: string): string {
	return `\`${value.replaceAll("`", "'")}\``;
}

function toCodeBlock(value: string, maxLength = 900): string {
	const sanitized = value.replaceAll("```", "'''").trim() || "n/a";
	return `\`\`\`\n${truncate(sanitized, maxLength)}\n\`\`\``;
}

function buildActivityLogUrl(log: LogErrorNotification): string {
	const configuredAppUrl = process.env.APP_URL?.trim();
	const appUrl =
		configuredAppUrl && configuredAppUrl.length > 0
			? configuredAppUrl
			: DEFAULT_APP_URL;
	return new URL(
		`/dashboard/${log.organizationId}/${log.projectId}/activity/${log.id}`,
		appUrl,
	).toString();
}

function buildGoogleCloudLogsUrl(log: LogErrorNotification): string {
	const configuredProjectId = process.env.GOOGLE_CLOUD_PROJECT?.trim();
	const projectId =
		configuredProjectId && configuredProjectId.length > 0
			? configuredProjectId
			: DEFAULT_GOOGLE_CLOUD_PROJECT;
	const query = [
		`jsonPayload.logId="${log.id}"`,
		`jsonPayload.requestId="${log.requestId}"`,
	].join(" OR ");

	return `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(query)};timeRange=PT24H?project=${encodeURIComponent(projectId)}`;
}

function buildFields(log: LogErrorNotification): DiscordEmbedField[] {
	const statusCode = log.errorDetails?.statusCode ?? 0;
	const statusText = log.errorDetails?.statusText ?? "unknown";
	const fields: DiscordEmbedField[] = [
		{
			name: "Log ID",
			value: toInlineCode(log.id),
			inline: true,
		},
		{
			name: "Request ID",
			value: toInlineCode(log.requestId),
			inline: true,
		},
		{
			name: "Status",
			value: truncate(
				`${statusCode} ${statusText}`.trim(),
				DISCORD_FIELD_LIMIT,
			),
			inline: true,
		},
		{
			name: "Used",
			value: truncate(
				`${log.usedProvider}/${log.usedModel}`,
				DISCORD_FIELD_LIMIT,
			),
			inline: false,
		},
		{
			name: "Requested",
			value: truncate(
				`${log.requestedProvider ?? "auto"}/${log.requestedModel}`,
				DISCORD_FIELD_LIMIT,
			),
			inline: false,
		},
		{
			name: "Organization",
			value: toInlineCode(log.organizationId),
			inline: true,
		},
		{
			name: "Project",
			value: toInlineCode(log.projectId),
			inline: true,
		},
		{
			name: "API Key",
			value: toInlineCode(log.apiKeyId),
			inline: true,
		},
		{
			name: "Finish Reason",
			value: truncate(
				`${log.unifiedFinishReason ?? "unknown"} (${log.finishReason ?? "unknown"})`,
				DISCORD_FIELD_LIMIT,
			),
			inline: true,
		},
		{
			name: "Retried",
			value: log.retried ? "yes" : "no",
			inline: true,
		},
		{
			name: "Trace ID",
			value: log.traceId ? toInlineCode(log.traceId) : "n/a",
			inline: true,
		},
		{
			name: "Links",
			value: truncate(
				`[Activity Log](${buildActivityLogUrl(log)})\n[Google Cloud Logs](${buildGoogleCloudLogsUrl(log)})`,
				DISCORD_FIELD_LIMIT,
			),
			inline: false,
		},
	];

	if (log.errorDetails?.cause) {
		fields.push({
			name: "Cause",
			value: truncate(log.errorDetails.cause, DISCORD_FIELD_LIMIT),
			inline: false,
		});
	}

	fields.push({
		name: "Error Response",
		value: toCodeBlock(log.errorDetails?.responseText ?? ""),
		inline: false,
	});

	return fields;
}

function buildPayload({
	log,
	errorKind,
}: LogErrorDiscordOptions): DiscordWebhookPayload {
	return {
		embeds: [
			{
				title: truncate(
					`${errorKind}: ${log.usedProvider}/${log.usedModel}`,
					256,
				),
				description: truncate(
					`A ${errorKind.toLowerCase()} log was persisted for project ${log.projectId}.`,
					512,
				),
				color: 0xef4444,
				fields: buildFields(log),
				timestamp: log.createdAt.toISOString(),
			},
		],
	};
}

export async function notifyLogErrorDiscord({
	log,
	webhookEnvVar,
	errorKind,
}: LogErrorDiscordOptions): Promise<void> {
	const webhookUrl = process.env[webhookEnvVar]?.trim();
	if (!webhookUrl) {
		return;
	}

	try {
		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(
				buildPayload({
					log,
					webhookEnvVar,
					errorKind,
				}),
			),
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			throw new Error(
				`Discord webhook error: ${response.status} ${await response.text()}`,
			);
		}
	} catch (error) {
		logger.error(
			"Failed to send log error Discord notification",
			error instanceof Error ? error : new Error(String(error)),
			{
				errorKind,
				webhookEnvVar,
				logId: log.id,
				requestId: log.requestId,
				traceId: log.traceId,
				usedProvider: log.usedProvider,
				usedModel: log.usedModel,
			},
		);
	}
}
