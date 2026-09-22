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

import type { ComplianceAlertSettings, organization } from "@llmgateway/db";
import type { ProviderCompliancePolicy } from "@llmgateway/models";

const DAY = 24 * 60 * 60 * 1000;
const USAGE_WINDOW_MS = 30 * DAY;
const DELIVERY_WINDOW_MS = DAY;
const MAX_DELIVERY_ATTEMPTS = 5;

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
 * Whether a user should still receive an org alert: an active member who is on
 * the org's recipient list.
 */
export async function isComplianceAlertRecipient(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const [membership, recipient] = await Promise.all([
		db.query.userOrganization.findFirst({
			where: { userId, organizationId },
			with: { user: true },
		}),
		db.query.complianceAlertRecipient.findFirst({
			where: { userId, organizationId },
		}),
	]);
	return membership?.user?.status === "active" && !!recipient;
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
	const [created] = await db
		.insert(organizationAlert)
		.values({ organizationId: org.id, ...alert })
		.onConflictDoNothing()
		.returning();
	if (!created) {
		return;
	}
	const recipients = await db.query.complianceAlertRecipient.findMany({
		where: { organizationId: org.id },
	});
	for (const { userId } of recipients) {
		if (!(await isComplianceAlertRecipient(userId, org.id))) {
			continue;
		}
		const preference = await db.query.notificationPreference.findFirst({
			where: { userId, type: alert.type },
		});
		const inApp = settings.inApp && (preference?.inApp ?? true);
		const email = settings.email && (preference?.email ?? true);
		if (!inApp && !email) {
			continue;
		}
		await db
			.insert(notification)
			.values({ ...alert, userId, organizationId: org.id, inApp, email })
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
	const policyChanged =
		!previous.length || previous.some((s) => s.policyHash !== policyHash);

	const downgraded: {
		providerId: string;
		failures: string[];
		compliantSince: Date;
	}[] = [];
	for (const provider of providers) {
		const failures = getProviderComplianceFailures(provider, policy);
		const compliant = failures.length === 0;
		const before = previous.find((s) => s.providerId === provider.id);
		if (!policyChanged && before?.compliant && !compliant) {
			downgraded.push({
				providerId: provider.id,
				failures: failures.map((f) => failureLabel(f, provider.headquarters)),
				compliantSince: before.updatedAt,
			});
		}
		if (
			before?.policyHash === policyHash &&
			before.compliant === compliant &&
			JSON.stringify(before.failures) === JSON.stringify(failures)
		) {
			continue;
		}
		await db
			.insert(complianceProviderState)
			.values({
				organizationId: org.id,
				providerId: provider.id,
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

	if (settings.downgrades) {
		for (const { providerId, failures, compliantSince } of downgraded) {
			const used = await modelsUsedOnProvider(org.id, providerId, now);
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
		if (compliantProviders.length && !watch.availableAt) {
			const [updated] = await db
				.update(modelAvailabilityWatch)
				.set({ availableAt: now })
				.where(
					and(
						eq(modelAvailabilityWatch.id, watch.id),
						isNull(modelAvailabilityWatch.availableAt),
					),
				)
				.returning();
			if (!updated) {
				continue;
			}
			const name = await modelName(watch.modelId);
			await emitOrgAlert(org, settings, {
				type: "model_available",
				eventKey: `model_available:${watch.id}:${now.getTime()}`,
				title: `${name} is now available under your compliance policy`,
				message: `${name} (${watch.modelId}) can now be routed through ${compliantProviders.map(providerName).join(", ")}.`,
				href,
			});
		} else if (!compliantProviders.length && watch.availableAt) {
			await db
				.update(modelAvailabilityWatch)
				.set({ availableAt: null })
				.where(eq(modelAvailabilityWatch.id, watch.id));
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
		if (!policy?.enabled || !settings) {
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
	for (const delivery of pending) {
		const alert = delivery.alert;
		if (!alert) {
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
				.set({ sentAt: now, attempts: delivery.attempts + 1, lastError: null })
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
					attempts: channel ? delivery.attempts + 1 : MAX_DELIVERY_ATTEMPTS,
					lastError: message.slice(0, 500),
				})
				.where(eq(organizationAlertDelivery.id, delivery.id));
		}
	}
}
