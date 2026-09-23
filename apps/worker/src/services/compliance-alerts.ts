import {
	decryptNotificationChannelConfig,
	getModelAvailability,
	hashCompliancePolicy,
	notificationChannelSenders,
} from "@llmgateway/actions";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	sql,
	complianceProviderState,
	modelAvailabilityWatch,
	notification,
	organizationAlert,
	organizationAlertDelivery,
	projectHourlyModelStats,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderComplianceFailures,
	getProviderDefinition,
	providers,
} from "@llmgateway/models";
import { failureLabel } from "@llmgateway/shared";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";
import {
	isInAlertAudience,
	isOrganizationAdmin,
} from "@llmgateway/shared/organization-roles";

import type { ComplianceAlertSettings, organization } from "@llmgateway/db";
import type { ProviderCompliancePolicy } from "@llmgateway/models";

const DAY = 24 * 60 * 60 * 1000;
const USAGE_WINDOW_MS = 30 * DAY;
const DELIVERY_WINDOW_MS = DAY;
const MAX_DELIVERY_ATTEMPTS = 5;
// Stay well inside the notifications loop's 5-minute lock.
const DELIVERY_BUDGET_MS = 2 * 60 * 1000;

type Organization = typeof organization.$inferSelect;
type AlertType = "model_available" | "compliance_downgrade";

interface OrgAlert {
	type: AlertType;
	eventKey: string;
	title: string;
	message: string;
	href: string;
}

function providerName(providerId: string): string {
	return getProviderDefinition(providerId)?.name ?? providerId;
}

async function modelName(modelId: string): Promise<string> {
	const row = await db.query.model.findFirst({
		columns: { name: true },
		where: { id: modelId },
	});
	return row && row.name !== "(empty)" ? row.name : modelId;
}

/**
 * Whether a user should still receive an org alert: an active member whose
 * role is inside the organization's configured alert audience.
 */
export async function isComplianceAlertRecipient(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const membership = await db.query.userOrganization.findFirst({
		where: { userId, organizationId },
		with: { user: true, organization: true },
	});
	const audience =
		membership?.organization?.complianceAlertSettings?.recipientAudience;
	return (
		membership?.user?.status === "active" &&
		!!audience &&
		isInAlertAudience(membership.role, audience)
	);
}

/**
 * Records an org alert once per event key, then fans it out to recipients'
 * notifications and to each enabled org channel.
 */
export async function emitOrgAlert(
	org: Organization,
	settings: ComplianceAlertSettings,
	alert: OrgAlert,
): Promise<void> {
	// Org-scoped key: notification rows dedupe on (userId, eventKey).
	const eventKey = `${org.id}:${alert.eventKey}`;
	await db
		.insert(organizationAlert)
		.values({ organizationId: org.id, ...alert, eventKey })
		.onConflictDoNothing();
	// Fan-out below is idempotent, so a pass that failed midway completes it.
	const created = await db.query.organizationAlert.findFirst({
		where: { organizationId: org.id, eventKey },
	});
	if (!created) {
		return;
	}
	const members = await db.query.userOrganization.findMany({
		where: { organizationId: org.id },
		with: { user: { columns: { status: true, emailVerified: true } } },
	});
	for (const member of members) {
		const userId = member.userId;
		if (
			member.user?.status !== "active" ||
			!isInAlertAudience(member.role, settings.recipientAudience)
		) {
			continue;
		}
		const preference = await db.query.notificationPreference.findFirst({
			where: { userId, type: alert.type },
		});
		const inApp = settings.inApp && (preference?.inApp ?? true);
		const email =
			settings.email &&
			(preference?.email ?? true) &&
			member.user.emailVerified === true;
		if (!inApp && !email) {
			continue;
		}
		await db
			.insert(notification)
			.values({
				// The persisted alert, so a resumed fan-out matches what was sent.
				type: created.type,
				eventKey: created.eventKey,
				title: created.title,
				message: created.message,
				// Non-admins cannot open the compliance page; the models directory
				// shows them the same eligibility change.
				href: isOrganizationAdmin(member.role)
					? created.href
					: `/dashboard/${org.id}/org/models`,
				userId,
				organizationId: org.id,
				inApp,
				email,
			})
			.onConflictDoNothing();
	}
	const channels = await db.query.organizationNotificationChannel.findMany({
		where: { organizationId: org.id },
	});
	for (const channel of channels) {
		if (!settings.channels.includes(channel.kind)) {
			continue;
		}
		await db
			.insert(organizationAlertDelivery)
			.values({ alertId: created.id, kind: channel.kind })
			.onConflictDoNothing();
	}
}

/** Models the org used in the last 30 days on a provider, from the hourly rollup. */
async function modelsUsedOnProvider(
	organizationId: string,
	providerId: string,
	now: Date,
): Promise<string[]> {
	const projects = await db.query.project.findMany({
		columns: { id: true },
		where: { organizationId },
	});
	if (!projects.length) {
		return [];
	}
	const rows = await db
		.selectDistinct({
			model: sql<string>`split_part(split_part(${projectHourlyModelStats.usedModel}, '/', 2), ':', 1)`,
		})
		.from(projectHourlyModelStats)
		.where(
			and(
				inArray(
					projectHourlyModelStats.projectId,
					projects.map((p) => p.id),
				),
				eq(projectHourlyModelStats.usedProvider, providerId),
				gte(
					projectHourlyModelStats.hourTimestamp,
					new Date(now.getTime() - USAGE_WINDOW_MS),
				),
				lt(projectHourlyModelStats.hourTimestamp, now),
				sql`${projectHourlyModelStats.requestCount} > 0`,
			),
		);
	return rows.map((r) => r.model).filter(Boolean);
}

async function processOrganization(
	org: Organization,
	policy: ProviderCompliancePolicy,
	settings: ComplianceAlertSettings,
	now: Date,
): Promise<void> {
	const href = `/dashboard/${org.id}/org/compliance`;
	const policyHash = hashCompliancePolicy(policy);
	const previous = await db.query.complianceProviderState.findMany({
		where: { organizationId: org.id },
	});
	// First run, or the org edited its own policy: resync without alerting.
	// Rows for providers removed from the catalogue are never rewritten.
	const current = previous.filter((s) =>
		providers.some((p) => p.id === s.providerId),
	);
	const policyChanged =
		!current.length || current.some((s) => s.policyHash !== policyHash);

	const downgraded: {
		providerId: string;
		failures: string[];
		compliantSince: Date;
	}[] = [];
	const changed: {
		providerId: string;
		compliant: boolean;
		failures: string[];
	}[] = [];
	for (const provider of providers) {
		const failures = getProviderComplianceFailures(provider, policy);
		const compliant = failures.length === 0;
		const before = current.find((s) => s.providerId === provider.id);
		if (!policyChanged && before?.compliant && !compliant) {
			downgraded.push({
				providerId: provider.id,
				failures: failures.map((f) => failureLabel(f, provider.headquarters)),
				compliantSince: before.updatedAt,
			});
		}
		if (
			before?.policyHash !== policyHash ||
			before.compliant !== compliant ||
			JSON.stringify(before.failures) !== JSON.stringify(failures)
		) {
			changed.push({ providerId: provider.id, compliant, failures });
		}
	}

	// Alert before persisting the new state, so an interrupted pass retries.
	if (settings.downgrades) {
		// The used-model list spans every project, so it is only included when
		// the audience is limited to owners and admins. Project-scoped members
		// must not learn what other projects run.
		const includeUsage = settings.recipientAudience !== "member";
		for (const { providerId, failures, compliantSince } of downgraded) {
			const used = includeUsage
				? await modelsUsedOnProvider(org.id, providerId, now)
				: [];
			const availability = await getModelAvailability(used, policy, now);
			const blocked = used.filter((m) => !availability.get(m)?.length);
			const name = providerName(providerId);
			await emitOrgAlert(org, settings, {
				type: "compliance_downgrade",
				eventKey: `compliance_downgrade:provider:${providerId}:${compliantSince.getTime()}`,
				title: `${name} no longer meets your compliance policy`,
				message: `${name} is now excluded from routing: ${failures.join("; ")}.${
					blocked.length
						? ` These models your organization used in the last 30 days no longer have a compliant provider: ${blocked.join(", ")}.`
						: ""
				}`,
				href,
			});
		}
	}

	for (const { providerId, compliant, failures } of changed) {
		await db
			.insert(complianceProviderState)
			.values({
				organizationId: org.id,
				providerId,
				compliant,
				failures,
				policyHash,
			})
			.onConflictDoUpdate({
				target: [
					complianceProviderState.organizationId,
					complianceProviderState.providerId,
				],
				set: { compliant, failures, policyHash, updatedAt: now },
			});
	}

	const watches = await db.query.modelAvailabilityWatch.findMany({
		where: { organizationId: org.id },
	});
	const availability = await getModelAvailability(
		watches.map((w) => w.modelId),
		policy,
		now,
	);
	for (const watch of watches) {
		const compliantProviders = availability.get(watch.modelId) ?? [];
		// Alert first, then record the transition, so an interrupted pass
		// retries. `armedAt` scopes the event key to one blocked period.
		if (compliantProviders.length && !watch.availableAt) {
			const name = await modelName(watch.modelId);
			await emitOrgAlert(org, settings, {
				type: "model_available",
				eventKey: `model_available:${watch.id}:${watch.armedAt.getTime()}`,
				title: `${name} is now available under your compliance policy`,
				message: `${name} (${watch.modelId}) can now be routed through ${compliantProviders.map(providerName).join(", ")}.`,
				href,
			});
			await db
				.update(modelAvailabilityWatch)
				.set({ availableAt: now })
				.where(
					and(
						eq(modelAvailabilityWatch.id, watch.id),
						isNull(modelAvailabilityWatch.availableAt),
					),
				);
		} else if (!compliantProviders.length && watch.availableAt) {
			if (settings.downgrades && !policyChanged) {
				const name = await modelName(watch.modelId);
				await emitOrgAlert(org, settings, {
					type: "compliance_downgrade",
					eventKey: `compliance_downgrade:model:${watch.id}:${watch.availableAt.getTime()}`,
					title: `${name} is no longer available under your compliance policy`,
					message: `No provider serving ${name} (${watch.modelId}) meets your compliance policy anymore. You will be notified again if it becomes available.`,
					href,
				});
			}
			await db
				.update(modelAvailabilityWatch)
				.set({ availableAt: null, armedAt: now })
				.where(eq(modelAvailabilityWatch.id, watch.id));
		}
	}
}

/**
 * Detects watched models becoming available and providers that stop meeting
 * an org's compliance policy. Only orgs that configured alerts are evaluated.
 */
export async function processComplianceAlerts(now = new Date()): Promise<void> {
	const orgs = await db.query.organization.findMany({
		where: {
			status: "active",
			complianceAlertSettings: { isNotNull: true },
		},
	});
	for (const org of orgs) {
		const policy = org.providerCompliancePolicy;
		const settings = org.complianceAlertSettings;
		// Enterprise-only feature. Checked against the license, like the API, so
		// an expired or foreign license stops delivery instead of failing open.
		if (
			!hasOrganizationEnterpriseAccess(org.id, org.plan, now) ||
			!policy?.enabled ||
			!settings
		) {
			continue;
		}
		try {
			await processOrganization(org, policy, settings, now);
		} catch (error) {
			logger.error(
				"Compliance alert processing failed",
				error instanceof Error ? error : new Error(String(error)),
				{ organizationId: org.id },
			);
		}
	}
	await deliverOrgAlertChannels(now);
}

export async function deliverOrgAlertChannels(now = new Date()): Promise<void> {
	const pending = await db.query.organizationAlertDelivery.findMany({
		where: {
			sentAt: { isNull: true },
			attempts: { lt: MAX_DELIVERY_ATTEMPTS },
			createdAt: { gte: new Date(now.getTime() - DELIVERY_WINDOW_MS) },
		},
		with: { alert: true },
		orderBy: { createdAt: "asc" },
		limit: 100,
	});
	const deadline = Date.now() + DELIVERY_BUDGET_MS;
	for (const delivery of pending) {
		const alert = delivery.alert;
		if (!alert || Date.now() > deadline) {
			continue;
		}
		// Claim the attempt so an overlapping pass cannot send it twice.
		const [claimed] = await db
			.update(organizationAlertDelivery)
			.set({ attempts: delivery.attempts + 1 })
			.where(
				and(
					eq(organizationAlertDelivery.id, delivery.id),
					eq(organizationAlertDelivery.attempts, delivery.attempts),
					isNull(organizationAlertDelivery.sentAt),
				),
			)
			.returning();
		if (!claimed) {
			continue;
		}
		const channel = await db.query.organizationNotificationChannel.findFirst({
			where: { organizationId: alert.organizationId, kind: delivery.kind },
		});
		try {
			if (!channel) {
				throw new Error(`No ${delivery.kind} channel configured`);
			}
			const config = decryptNotificationChannelConfig(
				channel.config,
				channel.id,
				channel.organizationId,
			);
			await notificationChannelSenders[delivery.kind](config, alert);
			await db
				.update(organizationAlertDelivery)
				.set({ sentAt: now, lastError: null })
				.where(eq(organizationAlertDelivery.id, delivery.id));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.warn("Org alert channel delivery failed", {
				deliveryId: delivery.id,
				kind: delivery.kind,
				error: message,
			});
			await db
				.update(organizationAlertDelivery)
				.set({
					...(channel ? {} : { attempts: MAX_DELIVERY_ATTEMPTS }),
					lastError: message.slice(0, 500),
				})
				.where(eq(organizationAlertDelivery.id, delivery.id));
		}
	}
}
