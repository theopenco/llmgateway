import { logger } from "@llmgateway/logger";

interface ErrorDetails {
	statusCode: number;
	statusText: string;
	responseText: string;
	cause?: string;
}

export interface ProviderErrorNotificationLog {
	duration: number;
	errorDetails: ErrorDetails | null;
	logId: string;
	organizationId: string;
	projectId: string;
	requestId: string;
	requestedModel: string;
	requestedProvider: string | null;
	traceId: string | null;
	unifiedFinishReason: string;
	usedModel: string;
	usedModelMapping: string | null;
	usedProvider: string;
}

interface DiscordEmbed {
	title: string;
	description?: string;
	color?: number;
	fields?: Array<{
		name: string;
		value: string;
		inline?: boolean;
	}>;
	timestamp?: string;
}

function getProviderErrorDiscordUrl(): string | null {
	const url = process.env.PROVIDER_ERROR_DISCORD_URL?.trim();
	return url ?? null;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatErrorDescription(errorDetails: ErrorDetails | null): string {
	if (!errorDetails) {
		return "No error details captured.";
	}

	const lines = [
		`${errorDetails.statusCode} ${errorDetails.statusText}`.trim(),
		errorDetails.cause ? `Cause: ${errorDetails.cause}` : null,
		errorDetails.responseText || null,
	].filter((line): line is string => Boolean(line));

	return truncate(lines.join("\n"), 4000);
}

function buildDiscordEmbed(log: ProviderErrorNotificationLog): {
	embeds: DiscordEmbed[];
} {
	return {
		embeds: [
			{
				title: `Provider ${log.unifiedFinishReason.replaceAll("_", " ")}`,
				description: formatErrorDescription(log.errorDetails),
				color: 0xef4444,
				fields: [
					{
						name: "Provider",
						value: truncate(log.usedProvider, 1024),
						inline: true,
					},
					{
						name: "Model",
						value: truncate(log.usedModelMapping ?? log.usedModel, 1024),
						inline: true,
					},
					{
						name: "Requested",
						value: truncate(
							`${log.requestedProvider ?? "auto"} / ${log.requestedModel}`,
							1024,
						),
						inline: true,
					},
					{
						name: "Request ID",
						value: truncate(log.requestId, 1024),
					},
					{
						name: "Project",
						value: truncate(log.projectId, 1024),
						inline: true,
					},
					{
						name: "Organization",
						value: truncate(log.organizationId, 1024),
						inline: true,
					},
					{
						name: "Duration",
						value: `${log.duration}ms`,
						inline: true,
					},
					{
						name: "Trace ID",
						value: truncate(log.traceId ?? "n/a", 1024),
						inline: true,
					},
					{
						name: "Log ID",
						value: truncate(log.logId, 1024),
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	};
}

export async function notifyProviderError(
	log: ProviderErrorNotificationLog,
): Promise<void> {
	const providerErrorDiscordUrl = getProviderErrorDiscordUrl();

	if (!providerErrorDiscordUrl) {
		return;
	}

	try {
		const response = await fetch(providerErrorDiscordUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildDiscordEmbed(log)),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Discord webhook error: ${response.status} - ${errorText}`,
			);
		}
	} catch (error) {
		logger.error(
			`Failed to send provider error Discord notification for log ${log.logId}`,
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}
