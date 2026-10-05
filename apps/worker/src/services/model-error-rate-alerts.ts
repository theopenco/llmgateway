import { redisClient } from "@llmgateway/cache";
import {
	and,
	db,
	eq,
	excludeRegionalMappingRows,
	gte,
	modelProviderMappingHistory,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	deriveStabilityMetrics,
	MODEL_ERROR_RATE_ALERTS_SETTING_ID,
	parseModelErrorRateAlertsSettings,
	postDiscordWebhook,
} from "@llmgateway/shared";

import type {
	DiscordWebhookPayload,
	ModelErrorRateAlertRule,
} from "@llmgateway/shared";

const DISCORD_TIMEOUT_MS = 5_000;
const MAX_LISTED_MAPPINGS = 10;
const WARNING_COLOR = 0xf59e0b;
const MINUTE_MS = 60_000;

export interface MappingErrorCounts {
	mappingId: string;
	modelId: string;
	providerId: string;
	logsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
}

export interface MappingErrorRateHit extends MappingErrorCounts {
	requestCount: number;
	errorsCount: number;
	errorRate: number;
}

/** Mappings at or above the rule's error rate with enough traffic to judge. */
export function findMappingsOverThreshold(
	rule: ModelErrorRateAlertRule,
	rows: MappingErrorCounts[],
): MappingErrorRateHit[] {
	const hits: MappingErrorRateHit[] = [];
	for (const row of rows) {
		const { requestCount, errorsCount, errorRate } =
			deriveStabilityMetrics(row);
		if (
			errorRate !== null &&
			requestCount >= rule.minRequests &&
			errorRate >= rule.errorRatePercent
		) {
			hits.push({ ...row, requestCount, errorsCount, errorRate });
		}
	}
	return hits.sort(
		(a, b) => b.errorRate - a.errorRate || b.errorsCount - a.errorsCount,
	);
}

function formatWindow(minutes: number): string {
	if (minutes % 60 === 0) {
		return `${minutes / 60}h`;
	}
	return `${minutes}m`;
}

export function buildAlertPayload(
	rule: ModelErrorRateAlertRule,
	hits: MappingErrorRateHit[],
	adminUrl: string | undefined,
): DiscordWebhookPayload {
	const listed = hits.slice(0, MAX_LISTED_MAPPINGS);
	const lines = [
		`${hits.length} model ${hits.length === 1 ? "mapping is" : "mappings are"} at or above ${rule.errorRatePercent}% errors over the last ${formatWindow(rule.windowMinutes)} (min ${rule.minRequests} requests, credit traffic only).`,
	];
	if (hits.length > listed.length) {
		lines.push(`+${hits.length - listed.length} more not listed.`);
	}
	return {
		embeds: [
			{
				title: `High error rate: ${rule.label}`,
				...(adminUrl
					? { url: `${adminUrl.replace(/\/$/, "")}/unstable-mappings` }
					: {}),
				description: lines.join("\n"),
				color: WARNING_COLOR,
				fields: listed.map((hit) => ({
					name: `${hit.modelId} / ${hit.providerId}`,
					value: `**${hit.errorRate.toFixed(1)}%** · ${hit.errorsCount}/${hit.requestCount} requests · upstream ${hit.upstreamErrorsCount}, gateway ${hit.gatewayErrorsCount}`,
				})),
				timestamp: new Date().toISOString(),
			},
		],
	};
}

async function queryMappingErrorCounts(
	windowMinutes: number,
): Promise<MappingErrorCounts[]> {
	const mph = modelProviderMappingHistory;
	const windowMs = windowMinutes * MINUTE_MS;
	const windowStart = new Date(Date.now() - windowMs);
	const rows = await db
		.select({
			mappingId: mph.modelProviderMappingId,
			modelId: mph.modelId,
			providerId: mph.providerId,
			logsCount: sql<string>`coalesce(sum(${mph.logsCount}), 0)::bigint`,
			clientErrorsCount: sql<string>`coalesce(sum(${mph.clientErrorsCount}), 0)::bigint`,
			gatewayErrorsCount: sql<string>`coalesce(sum(${mph.gatewayErrorsCount}), 0)::bigint`,
			upstreamErrorsCount: sql<string>`coalesce(sum(${mph.upstreamErrorsCount}), 0)::bigint`,
		})
		.from(mph)
		.where(
			and(
				gte(mph.minuteTimestamp, windowStart),
				// BYOK failures are usually the customer's key, not an incident.
				eq(mph.usedMode, "credits"),
				excludeRegionalMappingRows(mph),
			),
		)
		.groupBy(mph.modelProviderMappingId, mph.modelId, mph.providerId);

	return rows.map((row) => ({
		mappingId: row.mappingId,
		modelId: row.modelId,
		providerId: row.providerId,
		logsCount: Number(row.logsCount),
		clientErrorsCount: Number(row.clientErrorsCount),
		gatewayErrorsCount: Number(row.gatewayErrorsCount),
		upstreamErrorsCount: Number(row.upstreamErrorsCount),
	}));
}

export function cooldownKey(ruleId: string, mappingId: string): string {
	return `model_error_rate_alert:${ruleId}:${mappingId}`;
}

async function alertRule(
	rule: ModelErrorRateAlertRule,
	webhookUrl: string,
): Promise<void> {
	const hits = findMappingsOverThreshold(
		rule,
		await queryMappingErrorCounts(rule.windowMinutes),
	);
	if (hits.length === 0) {
		return;
	}

	const fresh: MappingErrorRateHit[] = [];
	for (const hit of hits) {
		const reserved = await redisClient.set(
			cooldownKey(rule.id, hit.mappingId),
			"1",
			"EX",
			rule.cooldownMinutes * 60,
			"NX",
		);
		if (reserved === "OK") {
			fresh.push(hit);
		}
	}
	if (fresh.length === 0) {
		return;
	}

	try {
		await postDiscordWebhook(
			webhookUrl,
			buildAlertPayload(rule, fresh, process.env.ADMIN_URL),
			{ timeoutMs: DISCORD_TIMEOUT_MS },
		);
	} catch (error) {
		// Release the cooldowns so the next tick retries the delivery.
		await redisClient.del(
			...fresh.map((hit) => cooldownKey(rule.id, hit.mappingId)),
		);
		throw error;
	}
	logger.info("Sent model error-rate alert", {
		ruleId: rule.id,
		mappings: fresh.length,
	});
}

/** Evaluates every enabled rule and posts new breaches to Discord. */
export async function checkModelErrorRateAlerts(): Promise<void> {
	const setting = await db.query.systemSetting.findFirst({
		where: { id: MODEL_ERROR_RATE_ALERTS_SETTING_ID },
	});
	if (!setting?.enabled) {
		return;
	}
	const webhookUrl = process.env.MODEL_ERROR_RATE_DISCORD_URL;
	if (!webhookUrl) {
		logger.warn(
			"Model error-rate alerts are enabled but MODEL_ERROR_RATE_DISCORD_URL is not set",
		);
		return;
	}

	const settings = parseModelErrorRateAlertsSettings(setting.value);
	for (const rule of settings.rules) {
		if (!rule.enabled) {
			continue;
		}
		try {
			await alertRule(rule, webhookUrl);
		} catch (error) {
			logger.error(
				`Model error-rate alert rule ${rule.id} failed`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
