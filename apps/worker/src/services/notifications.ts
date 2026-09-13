import { Decimal } from "decimal.js";

import { getApiKeyScope, getUserProjectIds } from "@llmgateway/actions";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	sql,
	apiKeyHourlyModelStats,
	notification,
	getApiKeyCurrentPeriodState,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	fromEmail,
	getResendClient,
	replyToEmail,
} from "@llmgateway/shared/email";

import type { ApiKeyScope } from "@llmgateway/actions";
import type { notificationPreference } from "@llmgateway/db";

const DAY = 24 * 60 * 60 * 1000;
const USAGE_WINDOW_MS = 30 * DAY;
const HEALTH_FRESHNESS_MS = 10 * 60 * 1000;
// Keep retries inside the email provider’s 24-hour idempotency window.
const EMAIL_RETRY_MS = 23 * 60 * 60 * 1000;
type Preference = typeof notificationPreference.$inferSelect;
type Event = Pick<
	typeof notification.$inferInsert,
	"projectId" | "apiKeyId" | "type" | "eventKey" | "title" | "message" | "href"
>;

export function isNearBudget(
	usage: string,
	limit: string | null,
	threshold: number,
): boolean {
	return (
		limit !== null &&
		new Decimal(limit).gt(0) &&
		new Decimal(usage).gte(new Decimal(limit).mul(threshold).div(100))
	);
}

export function providerHasIssues(
	provider: {
		logsCount: number;
		upstreamErrorsCount: number;
		clientErrorsCount: number;
		cachedCount: number;
		statsUpdatedAt: Date | null;
	},
	now: Date,
): boolean {
	const requests =
		provider.logsCount - provider.cachedCount - provider.clientErrorsCount;
	return (
		!!provider.statsUpdatedAt &&
		provider.statsUpdatedAt.getTime() >= now.getTime() - HEALTH_FRESHNESS_MS &&
		requests >= 20 &&
		provider.upstreamErrorsCount / requests >= 0.2
	);
}

function canReadEvent(
	scope: ApiKeyScope,
	event: Pick<Event, "projectId" | "apiKeyId">,
): boolean {
	return (
		scope.privilegedProjectIds.includes(event.projectId) ||
		(scope.restrictedProjectIds.includes(event.projectId) &&
			!!event.apiKeyId &&
			scope.ownApiKeyIds.includes(event.apiKeyId))
	);
}

async function recordEvent(
	userId: string,
	preference: Preference,
	event: Event,
) {
	await db
		.insert(notification)
		.values({
			...event,
			userId,
			inApp: preference.inApp,
			email: preference.email,
		})
		.onConflictDoNothing();
}

export async function processNotifications(now = new Date()): Promise<void> {
	const preferences = await db.query.notificationPreference.findMany({
		where: { OR: [{ inApp: true }, { email: true }] },
	});
	const userIds = [...new Set(preferences.map((p) => p.userId))];
	const mappings = await db.query.modelProviderMapping.findMany({
		where: {
			OR: [
				{ deprecatedAt: { isNotNull: true } },
				{ deactivatedAt: { isNotNull: true } },
			],
		},
	});
	const providers = await db.query.provider.findMany({
		where: { status: "active" },
	});
	for (const userId of userIds) {
		const recipient = await db.query.user.findFirst({
			where: { id: userId, status: "active" },
		});
		if (!recipient) {
			continue;
		}
		const projects = await getUserProjectIds(userId);
		if (!projects.length) {
			continue;
		}
		const scope = await getApiKeyScope(userId, projects);
		const userPreferences = preferences.filter((p) => p.userId === userId);
		const budget = userPreferences.find((p) => p.type === "budget");
		if (budget) {
			const keys = await db.query.apiKey.findMany({
				where: {
					projectId: { in: projects },
					status: "active",
					keyType: "user",
					kind: "regular",
				},
			});
			for (const key of keys) {
				if (
					!canReadEvent(scope, {
						projectId: key.projectId,
						apiKeyId: key.id,
					}) ||
					(key.expiresAt && key.expiresAt <= now)
				) {
					continue;
				}
				const period = getApiKeyCurrentPeriodState(key, now);
				for (const entry of [
					{
						name: "total",
						usage: key.usage,
						limit: key.usageLimit,
						period: "lifetime",
					},
					{
						name: "period",
						usage: period.usage,
						limit: key.periodUsageLimit,
						period: period.startedAt?.toISOString() ?? "unstarted",
					},
				]) {
					if (!isNearBudget(entry.usage, entry.limit, budget.budgetThreshold)) {
						continue;
					}
					const project = await db.query.project.findFirst({
						where: { id: key.projectId },
					});
					if (!project) {
						continue;
					}
					const percentage = new Decimal(entry.usage)
						.div(entry.limit!)
						.mul(100)
						.floor()
						.toNumber();
					await recordEvent(userId, budget, {
						projectId: key.projectId,
						apiKeyId: key.id,
						type: "budget",
						eventKey: `budget:${key.id}:${entry.name}:${entry.limit}:${entry.period}:${budget.budgetThreshold}`,
						title: `API key nearing its ${entry.name} budget`,
						message: `${key.description} has used ${percentage}% of its ${entry.name} budget. Review usage or adjust the limit before requests are blocked.`,
						href: `/dashboard/${project.organizationId}/${project.id}/api-keys`,
					});
				}
			}
		}
		const retirement = userPreferences.find(
			(p) => p.type === "model_retirement",
		);
		const health = userPreferences.find((p) => p.type === "provider_issue");
		if (!retirement && !health) {
			continue;
		}
		const usage = await db
			.selectDistinct({
				projectId: apiKeyHourlyModelStats.projectId,
				apiKeyId: apiKeyHourlyModelStats.apiKeyId,
				model: apiKeyHourlyModelStats.usedModel,
				provider: apiKeyHourlyModelStats.usedProvider,
			})
			.from(apiKeyHourlyModelStats)
			.where(
				and(
					inArray(apiKeyHourlyModelStats.projectId, projects),
					gte(
						apiKeyHourlyModelStats.hourTimestamp,
						new Date(now.getTime() - USAGE_WINDOW_MS),
					),
					lt(apiKeyHourlyModelStats.hourTimestamp, now),
					sql`${apiKeyHourlyModelStats.requestCount} > 0`,
				),
			);
		for (const used of usage) {
			if (!canReadEvent(scope, used)) {
				continue;
			}
			// Keep key attribution for developers; privileged users receive one alert per project.
			const audience = scope.privilegedProjectIds.includes(used.projectId)
				? used.projectId
				: used.apiKeyId;
			if (retirement) {
				for (const mapping of mappings.filter(
					(m) => m.modelId === used.model && m.providerId === used.provider,
				)) {
					for (const [kind, date] of [
						["deprecated", mapping.deprecatedAt],
						["deactivated", mapping.deactivatedAt],
					] as const) {
						if (
							!date ||
							date.getTime() < now.getTime() - DAY ||
							date.getTime() > now.getTime() + USAGE_WINDOW_MS
						) {
							continue;
						}
						await recordEvent(userId, retirement, {
							projectId: used.projectId,
							apiKeyId: used.apiKeyId,
							type: "model_retirement",
							eventKey: `retirement:${audience}:${mapping.id}:${kind}:${date.toISOString()}`,
							title: `Model ${kind === "deprecated" ? "deprecation" : "deactivation"} approaching`,
							message: `${used.provider}/${used.model}${mapping.region ? ` (${mapping.region})` : ""} is scheduled to be ${kind} on ${date.toISOString().slice(0, 10)}. Move to a newer active model before this date; compare capabilities and pricing in the model catalogue.`,
							href: "/models",
						});
					}
				}
			}
			const provider = providers.find((p) => p.id === used.provider);
			if (health && provider && providerHasIssues(provider, now)) {
				await recordEvent(userId, health, {
					projectId: used.projectId,
					apiKeyId: used.apiKeyId,
					type: "provider_issue",
					eventKey: `provider:${audience}:${provider.id}:${now.toISOString().slice(0, 10)}`,
					title: `${provider.name} is experiencing errors`,
					message: `Recent requests to ${provider.name} show elevated upstream errors. This provider served your traffic in the last 30 days. Check its status and consider another provider while it recovers.`,
					href: `/providers/${provider.id}`,
				});
			}
		}
	}
	await deliverNotificationEmails(now);
}

export async function deliverNotificationEmails(
	now = new Date(),
): Promise<void> {
	const client = getResendClient();
	if (!client) {
		return;
	}
	const pending = await db.query.notification.findMany({
		where: {
			email: true,
			emailSentAt: { isNull: true },
			createdAt: { gte: new Date(now.getTime() - EMAIL_RETRY_MS) },
		},
		orderBy: { createdAt: "asc" },
		limit: 100,
	});
	for (const item of pending) {
		const recipient = await db.query.user.findFirst({
			where: { id: item.userId, status: "active", emailVerified: true },
		});
		const preference = await db.query.notificationPreference.findFirst({
			where: { userId: item.userId, type: item.type, email: true },
		});
		if (!recipient || !preference) {
			continue;
		}
		const scope = await getApiKeyScope(
			item.userId,
			await getUserProjectIds(item.userId),
		);
		if (!canReadEvent(scope, item)) {
			continue;
		}
		try {
			const { error } = await client.emails.send(
				{
					from: fromEmail,
					replyTo: replyToEmail,
					to: recipient.email,
					subject: item.title,
					text: `${item.message}\n\n${process.env.UI_URL ?? "https://llmgateway.io"}${item.href}\n\nManage delivery from Notifications in your dashboard.`,
				},
				{ idempotencyKey: `notification/${item.id}` },
			);
			if (error) {
				throw new Error(error.message);
			}
			await db
				.update(notification)
				.set({ emailSentAt: now })
				.where(
					and(eq(notification.id, item.id), isNull(notification.emailSentAt)),
				);
		} catch (error) {
			logger.error(
				"Notification email delivery failed",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
