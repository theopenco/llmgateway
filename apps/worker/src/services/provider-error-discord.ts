import { createHash } from "node:crypto";

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
	unifiedFinishReason: string | null;
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

const DISCORD_WEBHOOK_TIMEOUT_MS = 5000;
const REDACTED_EMAIL = "<redacted-email>";
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function getProviderErrorDiscordUrl(): string | null {
	const url = process.env.PROVIDER_ERROR_DISCORD_URL?.trim();
	if (!url) {
		return null;
	}

	return url;
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function hashValue(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function formatIdentifier(value: string | null): string {
	if (!value) {
		return "n/a";
	}

	return `redacted:${hashValue(value)}`;
}

function sanitizeErrorText(
	value: string,
	log: ProviderErrorNotificationLog,
): string {
	let sanitized = value;

	for (const [label, rawValue] of [
		["request_id", log.requestId],
		["project_id", log.projectId],
		["organization_id", log.organizationId],
		["trace_id", log.traceId],
		["log_id", log.logId],
	] as const) {
		if (!rawValue) {
			continue;
		}

		sanitized = sanitized
			.split(rawValue)
			.join(`<${label}:${formatIdentifier(rawValue)}>`);
	}

	return sanitized.replace(EMAIL_PATTERN, REDACTED_EMAIL);
}

function formatErrorDescription(
	errorDetails: ErrorDetails | null,
	log: ProviderErrorNotificationLog,
): string {
	if (!errorDetails) {
		return "No error details captured.";
	}

	const lines = [
		`${errorDetails.statusCode} ${errorDetails.statusText}`.trim(),
		errorDetails.cause
			? `Cause: ${sanitizeErrorText(errorDetails.cause, log)}`
			: null,
		errorDetails.responseText
			? sanitizeErrorText(errorDetails.responseText, log)
			: null,
	].filter((line): line is string => Boolean(line));

	return truncate(lines.join("\n"), 4000);
}

function buildDiscordEmbed(log: ProviderErrorNotificationLog): {
	embeds: DiscordEmbed[];
} {
	const errorType = log.unifiedFinishReason?.replaceAll("_", " ") ?? "error";

	return {
		embeds: [
			{
				title: `Provider ${errorType}`,
				description: formatErrorDescription(log.errorDetails, log),
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
						value: formatIdentifier(log.requestId),
					},
					{
						name: "Project",
						value: formatIdentifier(log.projectId),
						inline: true,
					},
					{
						name: "Organization",
						value: formatIdentifier(log.organizationId),
						inline: true,
					},
					{
						name: "Duration",
						value: `${log.duration}ms`,
						inline: true,
					},
					{
						name: "Trace ID",
						value: formatIdentifier(log.traceId),
						inline: true,
					},
					{
						name: "Log ID",
						value: formatIdentifier(log.logId),
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
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, DISCORD_WEBHOOK_TIMEOUT_MS);
		try {
			const response = await fetch(providerErrorDiscordUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(buildDiscordEmbed(log)),
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Discord webhook error: ${response.status} - ${errorText}`,
				);
			}
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		const errorToLog =
			error instanceof Error && error.name === "AbortError"
				? new Error(
						`Discord webhook timed out after ${DISCORD_WEBHOOK_TIMEOUT_MS}ms`,
					)
				: error instanceof Error
					? error
					: new Error(String(error));

		logger.error(
			`Failed to send provider error Discord notification for log ${log.logId}`,
			errorToLog,
		);
	}
}
