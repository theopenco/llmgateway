import { logger } from "@llmgateway/logger";

interface ProviderErrorLogNotification {
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

function buildActivityLogUrl(log: ProviderErrorLogNotification): string {
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

function buildGoogleCloudLogsUrl(log: ProviderErrorLogNotification): string {
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

function buildFields(log: ProviderErrorLogNotification): DiscordEmbedField[] {
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
		name: "Provider Response",
		value: toCodeBlock(log.errorDetails?.responseText ?? ""),
		inline: false,
	});

	return fields;
}

function buildPayload(
	log: ProviderErrorLogNotification,
): DiscordWebhookPayload {
	return {
		embeds: [
			{
				title: truncate(
					`Provider Error: ${log.usedProvider}/${log.usedModel}`,
					256,
				),
				description: truncate(
					`A provider error log was persisted for project ${log.projectId}.`,
					512,
				),
				color: 0xef4444,
				fields: buildFields(log),
				timestamp: log.createdAt.toISOString(),
			},
		],
	};
}

export async function notifyProviderErrorDiscord(
	log: ProviderErrorLogNotification,
): Promise<void> {
	const webhookUrl = process.env.PROVIDER_ERROR_DISCORD_URL?.trim();
	if (!webhookUrl) {
		return;
	}

	try {
		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildPayload(log)),
			signal: AbortSignal.timeout(10_000),
		});

		if (!response.ok) {
			throw new Error(
				`Discord webhook error: ${response.status} ${await response.text()}`,
			);
		}
	} catch (error) {
		logger.error(
			"Failed to send provider error Discord notification",
			error instanceof Error ? error : new Error(String(error)),
			{
				logId: log.id,
				requestId: log.requestId,
				usedProvider: log.usedProvider,
				usedModel: log.usedModel,
			},
		);
	}
}
