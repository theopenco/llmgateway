import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

import { getApiKeyScope, getUserProjectIds } from "@llmgateway/actions";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	isEmailSuppressed,
	isNull,
	lt,
	max,
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
import {
	buildUnsubscribeHeaders,
	getEmailCategoryLabel,
	renderFooterText,
	signUnsubscribeToken,
} from "@llmgateway/shared/email-unsubscribe";

import {
	isOrgAlertRecipient,
	processComplianceAlerts,
} from "./compliance-alerts.js";
import { processModelPriceAlerts } from "./model-price-alerts.js";
import { canReadEvent } from "./notification-scope.js";

import type { notificationPreference } from "@llmgateway/db";

const DAY = 24 * 60 * 60 * 1000;
const USAGE_WINDOW_MS = 30 * DAY;
const HEALTH_FRESHNESS_MS = 10 * 60 * 1000;
// Provider issue alerts only cover mappings used this recently.
const ISSUE_USAGE_WINDOW_MS = DAY;
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

export function hasUpstreamIssues(
	stats: {
		logsCount: number;
		upstreamErrorsCount: number;
		clientErrorsCount: number;
		cachedCount: number;
		statsUpdatedAt: Date | null;
	},
	now: Date,
): boolean {
	const requests =
		stats.logsCount - stats.cachedCount - stats.clientErrorsCount;
	return (
		!!stats.statsUpdatedAt &&
		stats.statsUpdatedAt.getTime() >= now.getTime() - HEALTH_FRESHNESS_MS &&
		requests >= 20 &&
		stats.upstreamErrorsCount / requests >= 0.2
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
		where: {
			type: { in: ["budget", "model_retirement", "provider_issue"] },
			OR: [{ inApp: true }, { email: true }],
		},
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
	const unhealthyMappings = (
		await db.query.modelProviderMapping.findMany({
			where: {
				upstreamErrorsCount: { gt: 0 },
				statsUpdatedAt: {
					gte: new Date(now.getTime() - HEALTH_FRESHNESS_MS),
				},
			},
		})
	).filter((m) => hasUpstreamIssues(m, now));
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
		const projectNames = new Map(
			(
				await db.query.project.findMany({ where: { id: { in: projects } } })
			).map((p) => [p.id, p.name]),
		);
		const model = sql<string>`split_part(split_part(${apiKeyHourlyModelStats.usedModel}, '/', 2), ':', 1)`;
		const region = sql<string>`split_part(${apiKeyHourlyModelStats.usedModel}, ':', 2)`;
		const usage = await db
			.select({
				projectId: apiKeyHourlyModelStats.projectId,
				apiKeyId: apiKeyHourlyModelStats.apiKeyId,
				model,
				region,
				provider: apiKeyHourlyModelStats.usedProvider,
				lastUsedHour: max(apiKeyHourlyModelStats.hourTimestamp),
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
			)
			.groupBy(
				apiKeyHourlyModelStats.projectId,
				apiKeyHourlyModelStats.apiKeyId,
				model,
				region,
				apiKeyHourlyModelStats.usedProvider,
			);
		for (const used of usage) {
			if (!canReadEvent(scope, used)) {
				continue;
			}
			// Keep key attribution for developers; privileged users receive one alert per project.
			const audience = scope.privilegedProjectIds.includes(used.projectId)
				? used.projectId
				: used.apiKeyId;
			const projectLabel = `Project "${projectNames.get(used.projectId) ?? used.projectId}"`;
			if (retirement) {
				for (const mapping of mappings.filter(
					(m) =>
						m.modelId === used.model &&
						m.providerId === used.provider &&
						(m.region ?? "") === used.region,
				)) {
					for (const [kind, date] of [
						["deprecated", mapping.deprecatedAt],
						["deactivated", mapping.deactivatedAt],
					] as const) {
						if (
							!date ||
							date.getTime() <= now.getTime() ||
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
							message: `${used.provider}/${used.model}${mapping.region ? ` (${mapping.region})` : ""} is scheduled to be ${kind} on ${date.toISOString().slice(0, 10)}. ${projectLabel} used it in the last 30 days. Move to a newer active model before this date; compare capabilities and pricing in the model catalogue.`,
							href: "/models",
						});
					}
				}
			}
			const provider = providers.find((p) => p.id === used.provider);
			// Judge health per mapping the caller used in the last day, so the alert
			// names the affected model and skips unused or healthy ones.
			const usedRecently =
				!!used.lastUsedHour &&
				used.lastUsedHour.getTime() >= now.getTime() - ISSUE_USAGE_WINDOW_MS;
			const mapping = unhealthyMappings.find(
				(m) =>
					usedRecently &&
					m.modelId === used.model &&
					m.providerId === used.provider &&
					(m.region ?? "") === used.region,
			);
			if (health && provider && mapping) {
				await recordEvent(userId, health, {
					projectId: used.projectId,
					apiKeyId: used.apiKeyId,
					type: "provider_issue",
					eventKey: `provider:${audience}:${mapping.id}:${now.toISOString().slice(0, 10)}`,
					title: `${used.model} on ${provider.name} is experiencing errors`,
					message: `Recent requests to ${used.provider}/${used.model}${mapping.region ? ` (${mapping.region})` : ""} show elevated upstream errors. ${projectLabel} used it in the last 24 hours. Check the provider status and consider another provider for this model while it recovers.`,
					href: `/models/${encodeURIComponent(used.model)}/${encodeURIComponent(provider.id)}`,
				});
			}
		}
	}
	try {
		await processComplianceAlerts(now);
	} catch (error) {
		logger.error(
			"Compliance alert processing failed",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
	try {
		await processModelPriceAlerts(now);
	} catch (error) {
		logger.error(
			"Model price alert processing failed",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
	await deliverNotificationEmails(now);
}

type PendingItem = typeof notification.$inferSelect;

function getUiUrl(): string {
	return process.env.UI_URL ?? "https://llmgateway.io";
}

// The settings page lives under an org; user-level events (e.g. price
// changes) use the recipient's oldest membership.
async function getNotificationSettingsUrl(item: PendingItem): Promise<string> {
	const organizationId =
		item.organizationId ??
		(item.projectId
			? (
					await db.query.project.findFirst({
						where: { id: item.projectId },
					})
				)?.organizationId
			: undefined) ??
		(
			await db.query.userOrganization.findFirst({
				where: { userId: item.userId },
				orderBy: { createdAt: "asc" },
			})
		)?.organizationId;
	return organizationId
		? `${getUiUrl()}/dashboard/${organizationId}/org/notifications`
		: `${getUiUrl()}/dashboard`;
}

// Single notifications keep their original key so retries of emails queued
// before batching still dedupe; batches hash their member ids.
function getBatchIdempotencyKey(items: PendingItem[]): string {
	if (items.length === 1) {
		return `notification/${items[0].id}`;
	}
	const ids = items
		.map((item) => item.id)
		.sort()
		.join(",");
	return `notification-batch/${createHash("sha256").update(ids).digest("hex")}`;
}

export function renderNotificationEmail(
	items: PendingItem[],
	settingsUrl: string,
	token: string,
): { subject: string; text: string } {
	const [first] = items;
	const footer = renderFooterText(first.type, token, settingsUrl);
	if (items.length === 1) {
		return {
			subject: first.title,
			text: `${first.message}\n\n${getUiUrl()}${first.href}${footer}`,
		};
	}
	const sameTitle = items.every((item) => item.title === first.title);
	const sameHref = items.every((item) => item.href === first.href);
	const entries = items.map((item) =>
		[
			`- ${sameTitle ? item.message : `${item.title}: ${item.message}`}`,
			...(sameHref ? [] : [`  ${getUiUrl()}${item.href}`]),
		].join("\n"),
	);
	const label = getEmailCategoryLabel(first.type);
	return {
		subject: sameTitle
			? `${first.title} (${items.length})`
			: `${items.length} new ${label}`,
		text: `You have ${items.length} new ${label}:\n\n${entries.join("\n\n")}${sameHref ? `\n\n${getUiUrl()}${first.href}` : ""}${footer}`,
	};
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
	// One email per recipient and category, so a scan that detects several
	// events at once (e.g. right after opting in) does not flood the inbox.
	const batches = new Map<string, { email: string; items: PendingItem[] }>();
	for (const item of pending) {
		const recipient = await db.query.user.findFirst({
			where: { id: item.userId, status: "active", emailVerified: true },
		});
		// The address, not the user, owns the suppression: unsubscribing from an
		// inbox must stick even if the same person holds several accounts.
		const suppressed = recipient
			? await isEmailSuppressed(recipient.email, item.type)
			: false;
		if (item.organizationId) {
			// Org alerts: the org enabled email; recipients opt out via their own
			// preference. Skips are final, so the row leaves the pending queue.
			const optedOut = await db.query.notificationPreference.findFirst({
				where: { userId: item.userId, type: item.type, email: false },
			});
			if (
				!recipient ||
				optedOut ||
				suppressed ||
				!(await isOrgAlertRecipient(
					item.userId,
					item.organizationId,
					item.type,
				))
			) {
				await db
					.update(notification)
					.set({ email: false })
					.where(eq(notification.id, item.id));
				continue;
			}
		} else {
			if (!recipient) {
				continue;
			}
			if (suppressed) {
				// Terminal: an unsubscribed address never becomes eligible again
				// without an explicit resubscribe, which clears the row anyway.
				await db
					.update(notification)
					.set({ email: false })
					.where(eq(notification.id, item.id));
				continue;
			}
			const preference = await db.query.notificationPreference.findFirst({
				where: { userId: item.userId, type: item.type, email: true },
			});
			if (!preference) {
				continue;
			}
			// Price changes are public catalogue events with no project to check.
			if (
				item.type !== "model_price_change" &&
				!canReadEvent(
					await getApiKeyScope(
						item.userId,
						await getUserProjectIds(item.userId),
					),
					item,
				)
			) {
				continue;
			}
		}
		const key = `${item.userId}:${item.type}`;
		const batch = batches.get(key) ?? { email: recipient.email, items: [] };
		batch.items.push(item);
		batches.set(key, batch);
	}
	for (const { email, items: candidates } of batches.values()) {
		// Claim the batch before sending so a failed bookkeeping write cannot
		// resend these rows inside a different batch; a failed send releases it.
		const claimed = await db
			.update(notification)
			.set({ emailSentAt: now })
			.where(
				and(
					inArray(
						notification.id,
						candidates.map((item) => item.id),
					),
					isNull(notification.emailSentAt),
				),
			)
			.returning({ id: notification.id });
		const claimedIds = new Set(claimed.map((row) => row.id));
		const items = candidates.filter((item) => claimedIds.has(item.id));
		if (items.length === 0) {
			continue;
		}
		try {
			const [first] = items;
			const token = signUnsubscribeToken({ email, category: first.type });
			const { error } = await client.emails.send(
				{
					from: fromEmail,
					replyTo: replyToEmail,
					to: email,
					...renderNotificationEmail(
						items,
						await getNotificationSettingsUrl(first),
						token,
					),
					headers: buildUnsubscribeHeaders(token),
				},
				{ idempotencyKey: getBatchIdempotencyKey(items) },
			);
			if (error) {
				throw new Error(error.message);
			}
		} catch (error) {
			logger.error(
				"Notification email delivery failed",
				error instanceof Error ? error : new Error(String(error)),
			);
			await db
				.update(notification)
				.set({ emailSentAt: null })
				.where(
					and(
						inArray(
							notification.id,
							items.map((item) => item.id),
						),
						eq(notification.emailSentAt, now),
					),
				);
		}
	}
}
