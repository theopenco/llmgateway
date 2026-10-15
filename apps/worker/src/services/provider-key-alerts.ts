import { redisClient } from "@llmgateway/cache";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	log,
	lt,
	providerKey,
	providerKeyHourlyStats,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getProviderDefinition } from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";
import { providerKeyAlertSettingsSchema } from "@llmgateway/shared/provider-key-alerts";

import { emitOrgAlert } from "./compliance-alerts.js";

import type {
	organization,
	OrganizationNotificationChannelKind,
} from "@llmgateway/db";
import type {
	ProviderKeyAlertRule,
	ProviderKeyAlertSource,
} from "@llmgateway/shared/provider-key-alerts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_LISTED_MODELS = 5;

type Organization = typeof organization.$inferSelect;
type ProviderKey = typeof providerKey.$inferSelect;

export interface ErrorCounts {
	requestCount: number;
	clientErrorCount: number;
	gatewayErrorCount: number;
	upstreamErrorCount: number;
}

/**
 * One thing a rule judges: an organization's own key, or the platform's
 * credentials for one provider as used by this organization's credit traffic.
 * Platform credentials are grouped per provider: the organization cannot see
 * or act on individual managed keys, and rotation would otherwise split one
 * incident into several alerts.
 */
export type AlertTarget =
	| { kind: "byok"; id: string; key: ProviderKey }
	| { kind: "platform"; id: string; providerId: string };

export interface TargetErrorCounts extends ErrorCounts {
	targetId: string;
}

export interface TargetErrorRateHit extends TargetErrorCounts {
	/** Requests that were not client errors. */
	judgedCount: number;
	errorsCount: number;
	errorRate: number;
}

interface ModelErrorCounts extends ErrorCounts {
	usedModel: string;
}

interface Delivery {
	inApp: boolean;
	email: boolean;
	channels: OrganizationNotificationChannelKind[];
}

export function platformTargetId(providerId: string): string {
	return `platform:${providerId}`;
}

/** Targets at or above the rule's error rate with enough traffic to judge. */
export function findTargetsOverThreshold(
	rule: ProviderKeyAlertRule,
	rows: TargetErrorCounts[],
): TargetErrorRateHit[] {
	const hits: TargetErrorRateHit[] = [];
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

/**
 * Event key shared by every retry inside one cooldown slot, so a fan-out that
 * failed midway completes on the next pass instead of raising a second alert.
 */
export function alertEventKey(
	rule: ProviderKeyAlertRule,
	targetId: string,
	now: Date,
): string {
	const slot = Math.floor(now.getTime() / (rule.cooldownMinutes * MINUTE_MS));
	return `provider_key_errors:${targetId}:${rule.id}:${slot}`;
}

export function cooldownKey(
	organizationId: string,
	ruleId: string,
	targetId: string,
): string {
	return `provider_key_alert:${organizationId}:${ruleId}:${targetId}`;
}

const errorCountColumns = {
	requestCount: sql<string>`coalesce(sum(${providerKeyHourlyStats.requestCount}), 0)::bigint`,
	clientErrorCount: sql<string>`coalesce(sum(${providerKeyHourlyStats.clientErrorCount}), 0)::bigint`,
	gatewayErrorCount: sql<string>`coalesce(sum(${providerKeyHourlyStats.gatewayErrorCount}), 0)::bigint`,
	upstreamErrorCount: sql<string>`coalesce(sum(${providerKeyHourlyStats.upstreamErrorCount}), 0)::bigint`,
};

function toCounts(row: Record<keyof typeof errorCountColumns, string>) {
	return {
		requestCount: Number(row.requestCount),
		clientErrorCount: Number(row.clientErrorCount),
		gatewayErrorCount: Number(row.gatewayErrorCount),
		upstreamErrorCount: Number(row.upstreamErrorCount),
	};
}

async function queryByokErrorCounts(
	keyIds: string[],
	since: Date,
): Promise<TargetErrorCounts[]> {
	const s = providerKeyHourlyStats;
	const rows = await db
		.select({ targetId: s.providerKeyId, ...errorCountColumns })
		.from(s)
		.where(and(inArray(s.providerKeyId, keyIds), gte(s.hourTimestamp, since)))
		.groupBy(s.providerKeyId);
	return rows.map((row) => ({ targetId: row.targetId, ...toCounts(row) }));
}

/**
 * The organization's credit traffic on platform credentials, per provider.
 * `provider_key_hourly_stats` keeps `projectId` in its grain for exactly this
 * per-tenant split of a shared credential.
 */
async function queryPlatformErrorCounts(
	projectIds: string[],
	since: Date,
): Promise<(TargetErrorCounts & { providerId: string })[]> {
	const s = providerKeyHourlyStats;
	const rows = await db
		.select({ providerId: providerKey.provider, ...errorCountColumns })
		.from(s)
		.innerJoin(providerKey, eq(providerKey.id, s.providerKeyId))
		.where(
			and(
				inArray(s.projectId, projectIds),
				gte(s.hourTimestamp, since),
				eq(providerKey.managed, true),
			),
		)
		.groupBy(providerKey.provider);
	return rows.map((row) => ({
		targetId: platformTargetId(row.providerId),
		providerId: row.providerId,
		...toCounts(row),
	}));
}

/**
 * Per-model split for one target that already breached a rule. No rollup
 * holds this in near real time, so it reads `log` once per alert, bounded by
 * `log_provider_key_id_created_at_idx` (own keys) or
 * `log_project_id_created_at_idx` (platform credentials) on both ends.
 */
async function queryModelBreakdown(
	target: AlertTarget,
	projectIds: string[],
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
				target.kind === "byok"
					? eq(log.providerKeyId, target.key.id)
					: and(
							inArray(log.projectId, projectIds),
							eq(log.usedProvider, target.providerId),
							eq(log.usedMode, "credits"),
						),
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

function providerName(providerId: string): string {
	return getProviderDefinition(providerId)?.name ?? providerId;
}

export function targetLabel(target: AlertTarget): string {
	if (target.kind === "platform") {
		return `LLM Gateway's ${providerName(target.providerId)} credentials`;
	}
	const key = target.key;
	const provider =
		key.provider === "custom" && key.name
			? key.name
			: providerName(key.provider);
	const detail = key.description ?? key.tokenMasked;
	return `${provider} key ${detail}`;
}

export function buildAlertMessage(
	rule: ProviderKeyAlertRule,
	target: Pick<AlertTarget, "kind">,
	hit: TargetErrorRateHit,
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
		`${hit.errorRate.toFixed(1)}% of ${hit.judgedCount} ${target.kind === "platform" ? "credit " : ""}requests failed in the last ${formatWindow(rule.windowMinutes)} (${hit.upstreamErrorCount} rejected by the provider, ${hit.gatewayErrorCount} failed before reaching it); the "${rule.label}" rule alerts at ${rule.errorRatePercent}%.`,
	];
	if (failing.length) {
		parts.push(`Models affected: ${failing.join(", ")}.`);
	}
	parts.push(
		target.kind === "platform"
			? "Routing falls back to other providers where the model allows it. Check the provider's status page; no action is needed on your keys."
			: "Check that the key is valid, funded and allowed to use these models. Requests fall back to another provider or your credits where routing allows it.",
	);
	return parts.join(" ");
}

function targetHref(org: Organization, target: AlertTarget): string {
	return target.kind === "platform"
		? `/providers/${target.providerId}`
		: `/dashboard/${org.id}/org/provider-keys`;
}

async function alertRule(
	org: Organization,
	delivery: Delivery,
	rule: ProviderKeyAlertRule,
	source: ProviderKeyAlertSource,
	keys: ProviderKey[],
	projectIds: string[],
	now: Date,
): Promise<void> {
	const since = windowBucketStart(rule, now);
	const targets = new Map<string, AlertTarget>();
	const counts: TargetErrorCounts[] = [];
	if (source !== "platform" && keys.length) {
		for (const key of keys) {
			targets.set(key.id, { kind: "byok", id: key.id, key });
		}
		counts.push(
			...(await queryByokErrorCounts(
				keys.map((key) => key.id),
				since,
			)),
		);
	}
	if (source !== "byok" && projectIds.length) {
		for (const row of await queryPlatformErrorCounts(projectIds, since)) {
			targets.set(row.targetId, {
				kind: "platform",
				id: row.targetId,
				providerId: row.providerId,
			});
			counts.push(row);
		}
	}
	for (const hit of findTargetsOverThreshold(rule, counts)) {
		const target = targets.get(hit.targetId);
		if (!target) {
			continue;
		}
		const cooldown = cooldownKey(org.id, rule.id, target.id);
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
			const models = await queryModelBreakdown(target, projectIds, since, now);
			await emitOrgAlert(
				org,
				{ ...delivery, recipientAudience: "admin" },
				{
					type: "provider_key_errors",
					eventKey: alertEventKey(rule, target.id, now),
					title: `${targetLabel(target)} ${target.kind === "platform" ? "are" : "is"} failing your requests`,
					message: buildAlertMessage(rule, target, hit, models),
					href: targetHref(org, target),
				},
			);
		} catch (error) {
			// Release the cooldown so the next pass retries the alert.
			await redisClient.del(cooldown);
			throw error;
		}
		logger.info("Sent provider key error-rate alert", {
			organizationId: org.id,
			targetId: target.id,
			ruleId: rule.id,
			errorRate: hit.errorRate,
		});
	}
}

/**
 * Alerts organizations whose provider keys — their own, the platform's
 * credentials serving their credit traffic, or both, per `keySource` — fail at
 * a rate above one of their rules. Only organizations that enabled the alerts
 * are evaluated.
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
		const keys =
			settings.keySource === "platform"
				? []
				: await db.query.providerKey.findMany({
						where: { organizationId: org.id, status: "active", managed: false },
					});
		const projectIds =
			settings.keySource === "byok"
				? []
				: (
						await db.query.project.findMany({
							columns: { id: true },
							where: { organizationId: org.id },
						})
					).map((p) => p.id);
		if (!keys.length && !projectIds.length) {
			continue;
		}
		// Slack channels are an enterprise feature, as for compliance alerts: a
		// lapsed plan keeps its channel row but stops receiving posts.
		const delivery: Delivery = {
			inApp: settings.inApp,
			email: settings.email,
			channels: hasOrganizationEnterpriseAccess(org.id, org.plan, now)
				? settings.channels
				: [],
		};
		for (const rule of settings.rules) {
			if (!rule.enabled) {
				continue;
			}
			try {
				await alertRule(
					org,
					delivery,
					rule,
					settings.keySource,
					keys,
					projectIds,
					now,
				);
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
