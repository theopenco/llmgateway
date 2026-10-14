import { redisClient } from "@llmgateway/cache";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	log,
	lt,
	providerKeyHourlyStats,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getProviderDefinition } from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";
import { providerKeyAlertSettingsSchema } from "@llmgateway/shared/provider-key-alerts";

import { emitOrgAlert } from "./compliance-alerts.js";

import type {
	organization,
	OrganizationNotificationChannelKind,
	providerKey,
} from "@llmgateway/db";
import type { ProviderKeyAlertRule } from "@llmgateway/shared/provider-key-alerts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_LISTED_MODELS = 5;

type Organization = typeof organization.$inferSelect;
type ProviderKey = typeof providerKey.$inferSelect;

export interface KeyErrorCounts {
	providerKeyId: string;
	requestCount: number;
	clientErrorCount: number;
	gatewayErrorCount: number;
	upstreamErrorCount: number;
}

export interface KeyErrorRateHit extends KeyErrorCounts {
	/** Requests that were not client errors. */
	judgedCount: number;
	errorsCount: number;
	errorRate: number;
}

interface ModelErrorCounts extends Omit<KeyErrorCounts, "providerKeyId"> {
	usedModel: string;
}

/** Keys at or above the rule's error rate with enough traffic to judge. */
export function findKeysOverThreshold(
	rule: ProviderKeyAlertRule,
	rows: KeyErrorCounts[],
): KeyErrorRateHit[] {
	const hits: KeyErrorRateHit[] = [];
	for (const row of rows) {
		const { requestCount, errorsCount, errorRate } = deriveStabilityMetrics({
			logsCount: row.requestCount,
			clientErrorsCount: row.clientErrorCount,
			gatewayErrorsCount: row.gatewayErrorCount,
			upstreamErrorsCount: row.upstreamErrorCount,
		});
		if (
			errorRate !== null &&
			requestCount >= rule.minRequests &&
			errorRate >= rule.errorRatePercent
		) {
			hits.push({ ...row, judgedCount: requestCount, errorsCount, errorRate });
		}
	}
	return hits.sort((a, b) => b.errorRate - a.errorRate);
}

/**
 * Start of the hourly rollup range covering the rule window: the window
 * widens to the start of the hour it begins in.
 */
export function windowBucketStart(rule: ProviderKeyAlertRule, now: Date): Date {
	const windowMs = rule.windowMinutes * MINUTE_MS;
	const start = now.getTime() - windowMs;
	return new Date(Math.floor(start / HOUR_MS) * HOUR_MS);
}

function formatWindow(minutes: number): string {
	return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

export function cooldownKey(
	organizationId: string,
	ruleId: string,
	providerKeyId: string,
): string {
	return `provider_key_alert:${organizationId}:${ruleId}:${providerKeyId}`;
}

async function queryKeyErrorCounts(
	keyIds: string[],
	since: Date,
): Promise<KeyErrorCounts[]> {
	const s = providerKeyHourlyStats;
	const rows = await db
		.select({
			providerKeyId: s.providerKeyId,
			requestCount: sql<string>`coalesce(sum(${s.requestCount}), 0)::bigint`,
			clientErrorCount: sql<string>`coalesce(sum(${s.clientErrorCount}), 0)::bigint`,
			gatewayErrorCount: sql<string>`coalesce(sum(${s.gatewayErrorCount}), 0)::bigint`,
			upstreamErrorCount: sql<string>`coalesce(sum(${s.upstreamErrorCount}), 0)::bigint`,
		})
		.from(s)
		.where(and(inArray(s.providerKeyId, keyIds), gte(s.hourTimestamp, since)))
		.groupBy(s.providerKeyId);
	return rows.map((row) => ({
		providerKeyId: row.providerKeyId,
		requestCount: Number(row.requestCount),
		clientErrorCount: Number(row.clientErrorCount),
		gatewayErrorCount: Number(row.gatewayErrorCount),
		upstreamErrorCount: Number(row.upstreamErrorCount),
	}));
}

/**
 * Per-model split for one key that already breached a rule. No rollup holds
 * this per key in near real time, so it reads `log` once per alert, bounded by
 * `log_provider_key_id_created_at_idx` on both ends of the window.
 */
async function queryModelBreakdown(
	providerKeyId: string,
	since: Date,
	now: Date,
): Promise<ModelErrorCounts[]> {
	const rows = await db
		.select({
			usedModel: sql<string>`coalesce(${log.usedModel}, 'unknown')`,
			requestCount: sql<string>`count(*)::bigint`,
			clientErrorCount: sql<string>`count(*) filter (where ${log.unifiedFinishReason} = 'client_error')::bigint`,
			gatewayErrorCount: sql<string>`count(*) filter (where ${log.unifiedFinishReason} = 'gateway_error')::bigint`,
			upstreamErrorCount: sql<string>`count(*) filter (where ${log.unifiedFinishReason} = 'upstream_error')::bigint`,
		})
		.from(log)
		.where(
			and(
				eq(log.providerKeyId, providerKeyId),
				gte(log.createdAt, since),
				lt(log.createdAt, now),
			),
		)
		.groupBy(log.usedModel);
	return rows.map((row) => ({
		usedModel: row.usedModel,
		requestCount: Number(row.requestCount),
		clientErrorCount: Number(row.clientErrorCount),
		gatewayErrorCount: Number(row.gatewayErrorCount),
		upstreamErrorCount: Number(row.upstreamErrorCount),
	}));
}

function keyLabel(key: ProviderKey): string {
	const provider =
		key.provider === "custom" && key.name
			? key.name
			: (getProviderDefinition(key.provider)?.name ?? key.provider);
	const detail = key.description ?? key.tokenMasked;
	return `${provider} key ${detail}`;
}

export function buildAlertMessage(
	rule: ProviderKeyAlertRule,
	hit: KeyErrorRateHit,
	models: ModelErrorCounts[],
): string {
	const failing = models
		.map((model) => ({
			model: model.usedModel,
			...deriveStabilityMetrics({
				logsCount: model.requestCount,
				clientErrorsCount: model.clientErrorCount,
				gatewayErrorsCount: model.gatewayErrorCount,
				upstreamErrorsCount: model.upstreamErrorCount,
			}),
		}))
		.filter((model) => model.errorRate !== null && model.errorsCount > 0)
		.sort(
			(a, b) =>
				(b.errorRate ?? 0) - (a.errorRate ?? 0) ||
				b.errorsCount - a.errorsCount,
		)
		.slice(0, MAX_LISTED_MODELS)
		.map(
			(model) =>
				`${model.model} ${model.errorRate!.toFixed(0)}% (${model.errorsCount}/${model.requestCount})`,
		);
	const parts = [
		`${hit.errorRate.toFixed(1)}% of ${hit.judgedCount} requests failed in the last ${formatWindow(rule.windowMinutes)} (${hit.upstreamErrorCount} rejected by the provider, ${hit.gatewayErrorCount} failed before reaching it); the "${rule.label}" rule alerts at ${rule.errorRatePercent}%.`,
	];
	if (failing.length) {
		parts.push(`Models affected: ${failing.join(", ")}.`);
	}
	parts.push(
		"Check that the key is valid, funded and allowed to use these models. Requests fall back to another provider or your credits where routing allows it.",
	);
	return parts.join(" ");
}

async function alertRule(
	org: Organization,
	settings: {
		inApp: boolean;
		email: boolean;
		channels: OrganizationNotificationChannelKind[];
	},
	rule: ProviderKeyAlertRule,
	keys: ProviderKey[],
	now: Date,
): Promise<void> {
	const since = windowBucketStart(rule, now);
	const hits = findKeysOverThreshold(
		rule,
		await queryKeyErrorCounts(
			keys.map((key) => key.id),
			since,
		),
	);
	for (const hit of hits) {
		const key = keys.find((k) => k.id === hit.providerKeyId);
		if (!key) {
			continue;
		}
		const cooldown = cooldownKey(org.id, rule.id, key.id);
		const reserved = await redisClient.set(
			cooldown,
			"1",
			"EX",
			rule.cooldownMinutes * 60,
			"NX",
		);
		if (reserved !== "OK") {
			continue;
		}
		try {
			const models = await queryModelBreakdown(key.id, since, now);
			await emitOrgAlert(
				org,
				{ ...settings, recipientAudience: "admin" },
				{
					type: "provider_key_errors",
					eventKey: `provider_key_errors:${key.id}:${rule.id}:${now.getTime()}`,
					title: `${keyLabel(key)} is failing requests`,
					message: buildAlertMessage(rule, hit, models),
					href: `/dashboard/${org.id}/org/provider-keys`,
				},
			);
		} catch (error) {
			// Release the cooldown so the next pass retries the alert.
			await redisClient.del(cooldown);
			throw error;
		}
		logger.info("Sent provider key error-rate alert", {
			organizationId: org.id,
			providerKeyId: key.id,
			ruleId: rule.id,
			errorRate: hit.errorRate,
		});
	}
}

/**
 * Alerts organizations whose own provider keys fail at a rate above one of
 * their rules. Only organizations that enabled the alerts are evaluated;
 * platform-managed credentials are never included.
 */
export async function processProviderKeyAlerts(
	now = new Date(),
): Promise<void> {
	const orgs = await db.query.organization.findMany({
		where: {
			status: "active",
			providerKeyAlertSettings: { isNotNull: true },
		},
	});
	for (const org of orgs) {
		const parsed = providerKeyAlertSettingsSchema.safeParse(
			org.providerKeyAlertSettings,
		);
		if (!parsed.success) {
			logger.warn("Ignoring invalid provider key alert settings", {
				organizationId: org.id,
			});
			continue;
		}
		const settings = parsed.data;
		if (!settings.enabled) {
			continue;
		}
		const keys = await db.query.providerKey.findMany({
			where: { organizationId: org.id, status: "active", managed: false },
		});
		if (!keys.length) {
			continue;
		}
		for (const rule of settings.rules) {
			if (!rule.enabled) {
				continue;
			}
			try {
				await alertRule(org, settings, rule, keys, now);
			} catch (error) {
				logger.error(
					`Provider key alert rule ${rule.id} failed`,
					error instanceof Error ? error : new Error(String(error)),
					{ organizationId: org.id },
				);
			}
		}
	}
}
