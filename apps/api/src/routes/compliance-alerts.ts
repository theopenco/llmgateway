import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import {
	decryptNotificationChannelConfig,
	encryptNotificationChannelConfig,
	getModelAvailability,
	isSlackWebhookUrl,
	maskSlackWebhookUrl,
	notificationChannelSenders,
} from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	db,
	eq,
	isNull,
	notInArray,
	organizationNotificationChannelKinds,
	shortid,
	tables,
} from "@llmgateway/db";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";
import type { ComplianceAlertSettings } from "@llmgateway/db";
import type { Context } from "hono";

export const complianceAlerts = new OpenAPIHono<ServerTypes>();

const MAX_WATCHES = 100;
const DEFAULT_SETTINGS = {
	inApp: true,
	email: true,
	channels: [],
	downgrades: true,
} satisfies ComplianceAlertSettings;
const orgParams = z.object({ organizationId: z.string() });

async function assertOrgAccess(
	c: Context<ServerTypes>,
	organizationId: string,
	options: { manage?: boolean; enterprise?: boolean } = {},
) {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const membership = await db.query.userOrganization.findFirst({
		where: { organizationId, userId: user.id },
		with: { organization: true },
	});
	if (
		!membership?.organization ||
		membership.organization.status !== "active"
	) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (
		options.manage &&
		membership.role !== "owner" &&
		membership.role !== "admin"
	) {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can manage alerts",
		});
	}
	if (
		options.enterprise &&
		!hasOrganizationEnterpriseAccess(
			organizationId,
			membership.organization.plan,
		)
	) {
		throw new HTTPException(403, {
			message: "Compliance alerts require an enterprise plan",
		});
	}
	return { user, organization: membership.organization };
}

// --- Notification channels ---

const channelSchema = z.object({
	kind: z.enum(organizationNotificationChannelKinds),
	target: z.string(),
	updatedAt: z.string(),
});

complianceAlerts.openapi(
	createRoute({
		method: "get",
		path: "/{organizationId}/notification-channels",
		request: { params: orgParams },
		responses: {
			200: {
				description: "Configured notification channels",
				content: {
					"application/json": {
						schema: z.object({ channels: z.array(channelSchema) }),
					},
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		await assertOrgAccess(c, organizationId);
		const channels = await db.query.organizationNotificationChannel.findMany({
			where: { organizationId },
		});
		return c.json({
			channels: channels.map((channel) => ({
				kind: channel.kind,
				target: maskSlackWebhookUrl(
					decryptNotificationChannelConfig(
						channel.config,
						channel.id,
						organizationId,
					),
				),
				updatedAt: channel.updatedAt.toISOString(),
			})),
		});
	},
);

complianceAlerts.openapi(
	createRoute({
		method: "put",
		path: "/{organizationId}/notification-channels/slack",
		request: {
			params: orgParams,
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z.object({ webhookUrl: z.string().trim() }),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Saved Slack channel",
				content: { "application/json": { schema: channelSchema } },
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { webhookUrl } = c.req.valid("json");
		const { user } = await assertOrgAccess(c, organizationId, { manage: true });
		if (!isSlackWebhookUrl(webhookUrl)) {
			throw new HTTPException(400, {
				message:
					"Enter a Slack incoming webhook URL (https://hooks.slack.com/services/…)",
			});
		}
		const existing = await db.query.organizationNotificationChannel.findFirst({
			where: { organizationId, kind: "slack" },
		});
		const id = existing?.id ?? shortid();
		const config = encryptNotificationChannelConfig(
			webhookUrl,
			id,
			organizationId,
		);
		const [channel] = existing
			? await db
					.update(tables.organizationNotificationChannel)
					.set({ config })
					.where(eq(tables.organizationNotificationChannel.id, id))
					.returning()
			: await db
					.insert(tables.organizationNotificationChannel)
					.values({ id, organizationId, kind: "slack", config })
					.returning();
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "notification_channel.update",
			resourceType: "notification_channel",
			resourceId: channel.id,
			metadata: { resourceName: "slack" },
		});
		return c.json({
			kind: channel.kind,
			target: maskSlackWebhookUrl(webhookUrl),
			updatedAt: channel.updatedAt.toISOString(),
		});
	},
);

complianceAlerts.openapi(
	createRoute({
		method: "delete",
		path: "/{organizationId}/notification-channels/slack",
		request: { params: orgParams },
		responses: {
			200: {
				description: "Removed Slack channel",
				content: {
					"application/json": { schema: z.object({ success: z.boolean() }) },
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { user, organization } = await assertOrgAccess(c, organizationId, {
			manage: true,
		});
		const [removed] = await db
			.delete(tables.organizationNotificationChannel)
			.where(
				and(
					eq(
						tables.organizationNotificationChannel.organizationId,
						organizationId,
					),
					eq(tables.organizationNotificationChannel.kind, "slack"),
				),
			)
			.returning();
		const settings = organization.complianceAlertSettings;
		if (settings?.channels.includes("slack")) {
			await db
				.update(tables.organization)
				.set({
					complianceAlertSettings: {
						...settings,
						channels: settings.channels.filter((k) => k !== "slack"),
					},
				})
				.where(eq(tables.organization.id, organizationId));
		}
		if (removed) {
			await logAuditEvent({
				organizationId,
				userId: user.id,
				action: "notification_channel.delete",
				resourceType: "notification_channel",
				resourceId: removed.id,
				metadata: { resourceName: "slack" },
			});
		}
		return c.json({ success: true });
	},
);

complianceAlerts.openapi(
	createRoute({
		method: "post",
		path: "/{organizationId}/notification-channels/slack/test",
		request: { params: orgParams },
		responses: {
			200: {
				description: "Test message sent",
				content: {
					"application/json": { schema: z.object({ success: z.boolean() }) },
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		await assertOrgAccess(c, organizationId, { manage: true });
		const channel = await db.query.organizationNotificationChannel.findFirst({
			where: { organizationId, kind: "slack" },
		});
		if (!channel) {
			throw new HTTPException(404, { message: "No Slack channel configured" });
		}
		try {
			await notificationChannelSenders.slack(
				decryptNotificationChannelConfig(
					channel.config,
					channel.id,
					organizationId,
				),
				{
					title: "LLM Gateway test notification",
					message: "Slack notifications are connected for this organization.",
					href: `/dashboard/${organizationId}/org/preferences`,
				},
			);
		} catch (error) {
			throw new HTTPException(502, {
				message: `Slack rejected the test message: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
		return c.json({ success: true });
	},
);

// --- Compliance alerts ---

const settingsSchema = z.object({
	inApp: z.boolean(),
	email: z.boolean(),
	channels: z.array(z.enum(organizationNotificationChannelKinds)),
	downgrades: z.boolean(),
});

const watchSchema = z.object({
	id: z.string(),
	modelId: z.string(),
	availableAt: z.string().nullable(),
	compliantProviders: z.array(z.string()),
	createdAt: z.string(),
});

complianceAlerts.openapi(
	createRoute({
		method: "get",
		path: "/{organizationId}/compliance-alerts",
		request: { params: orgParams },
		responses: {
			200: {
				description: "Compliance alert configuration",
				content: {
					"application/json": {
						schema: z.object({
							settings: settingsSchema.nullable(),
							recipientUserIds: z.array(z.string()),
							watches: z.array(watchSchema),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { organization } = await assertOrgAccess(c, organizationId);
		const [watches, recipients] = await Promise.all([
			db.query.modelAvailabilityWatch.findMany({
				where: { organizationId },
				orderBy: { createdAt: "asc" },
			}),
			db.query.complianceAlertRecipient.findMany({
				where: { organizationId },
			}),
		]);
		const policy = organization.providerCompliancePolicy;
		const availability = policy?.enabled
			? await getModelAvailability(
					watches.map((w) => w.modelId),
					policy,
				)
			: new Map<string, string[]>();
		return c.json({
			settings: organization.complianceAlertSettings ?? null,
			recipientUserIds: recipients.map((r) => r.userId),
			watches: watches.map((watch) => ({
				id: watch.id,
				modelId: watch.modelId,
				availableAt: watch.availableAt?.toISOString() ?? null,
				compliantProviders: availability.get(watch.modelId) ?? [],
				createdAt: watch.createdAt.toISOString(),
			})),
		});
	},
);

complianceAlerts.openapi(
	createRoute({
		method: "post",
		path: "/{organizationId}/compliance-alerts/watches",
		request: {
			params: orgParams,
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z.object({
							modelIds: z.array(z.string().min(1)).min(1).max(MAX_WATCHES),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Watches created",
				content: {
					"application/json": { schema: z.object({ success: z.boolean() }) },
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { modelIds } = c.req.valid("json");
		const { user, organization } = await assertOrgAccess(c, organizationId, {
			manage: true,
			enterprise: true,
		});
		const unique = [...new Set(modelIds)];
		const known = await db.query.model.findMany({
			columns: { id: true },
			where: { id: { in: unique } },
		});
		const unknown = unique.filter((id) => !known.some((m) => m.id === id));
		if (unknown.length) {
			throw new HTTPException(400, {
				message: `Unknown models: ${unknown.join(", ")}`,
			});
		}
		const existing = await db.query.modelAvailabilityWatch.findMany({
			columns: { modelId: true },
			where: { organizationId },
		});
		const added = unique.filter(
			(id) => !existing.some((w) => w.modelId === id),
		);
		if (existing.length + added.length > MAX_WATCHES) {
			throw new HTTPException(400, {
				message: `An organization can watch at most ${MAX_WATCHES} models`,
			});
		}
		if (!added.length) {
			return c.json({ success: true });
		}
		// Stamp already-available models so they never trigger an alert.
		const policy = organization.providerCompliancePolicy;
		const now = new Date();
		const availability = policy?.enabled
			? await getModelAvailability(added, policy, now)
			: new Map<string, string[]>();
		await db
			.insert(tables.modelAvailabilityWatch)
			.values(
				added.map((modelId) => ({
					organizationId,
					modelId,
					createdByUserId: user.id,
					availableAt:
						!policy?.enabled || availability.get(modelId)?.length ? now : null,
				})),
			)
			.onConflictDoNothing();
		// The worker only evaluates configured orgs, so the first watch saves
		// the defaults the dashboard shows: in-app + email to owners and admins.
		if (!organization.complianceAlertSettings) {
			await db.transaction(async (tx) => {
				const [configured] = await tx
					.update(tables.organization)
					.set({ complianceAlertSettings: DEFAULT_SETTINGS })
					.where(
						and(
							eq(tables.organization.id, organizationId),
							isNull(tables.organization.complianceAlertSettings),
						),
					)
					.returning({ id: tables.organization.id });
				if (!configured) {
					return;
				}
				const admins = await tx.query.userOrganization.findMany({
					columns: { userId: true },
					where: { organizationId, role: { in: ["owner", "admin"] } },
				});
				if (admins.length) {
					await tx
						.insert(tables.complianceAlertRecipient)
						.values(admins.map((m) => ({ organizationId, userId: m.userId })))
						.onConflictDoNothing();
				}
			});
		}
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "compliance_alert.watch_create",
			resourceType: "compliance_alert",
			resourceId: organizationId,
			metadata: { resourceName: added.join(", ") },
		});
		return c.json({ success: true });
	},
);

complianceAlerts.openapi(
	createRoute({
		method: "delete",
		path: "/{organizationId}/compliance-alerts/watches/{watchId}",
		request: { params: orgParams.extend({ watchId: z.string() }) },
		responses: {
			200: {
				description: "Watch removed",
				content: {
					"application/json": { schema: z.object({ success: z.boolean() }) },
				},
			},
		},
	}),
	async (c) => {
		const { organizationId, watchId } = c.req.valid("param");
		const { user } = await assertOrgAccess(c, organizationId, {
			manage: true,
		});
		const [removed] = await db
			.delete(tables.modelAvailabilityWatch)
			.where(
				and(
					eq(tables.modelAvailabilityWatch.id, watchId),
					eq(tables.modelAvailabilityWatch.organizationId, organizationId),
				),
			)
			.returning();
		if (!removed) {
			throw new HTTPException(404, { message: "Watch not found" });
		}
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "compliance_alert.watch_delete",
			resourceType: "compliance_alert",
			resourceId: removed.id,
			metadata: { resourceName: removed.modelId },
		});
		return c.json({ success: true });
	},
);

complianceAlerts.openapi(
	createRoute({
		method: "put",
		path: "/{organizationId}/compliance-alerts/settings",
		request: {
			params: orgParams,
			body: {
				required: true,
				content: {
					"application/json": {
						schema: settingsSchema.extend({
							recipientUserIds: z.array(z.string()).max(500),
						}),
					},
				},
			},
		},
		responses: {
			200: {
				description: "Saved settings",
				content: { "application/json": { schema: settingsSchema } },
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { recipientUserIds, ...settings } = c.req.valid("json");
		const { user, organization } = await assertOrgAccess(c, organizationId, {
			manage: true,
			enterprise: true,
		});
		const recipients = [...new Set(recipientUserIds)];
		if (recipients.length) {
			const members = await db.query.userOrganization.findMany({
				columns: { userId: true },
				where: { organizationId, userId: { in: recipients } },
			});
			if (members.length !== recipients.length) {
				throw new HTTPException(400, {
					message: "Recipients must be members of the organization",
				});
			}
		}
		const channels = [...new Set(settings.channels)];
		if (channels.length) {
			const configured =
				await db.query.organizationNotificationChannel.findMany({
					columns: { kind: true },
					where: { organizationId, kind: { in: channels } },
				});
			const missing = channels.filter(
				(kind) => !configured.some((ch) => ch.kind === kind),
			);
			if (missing.length) {
				throw new HTTPException(400, {
					message: `Configure ${missing.join(", ")} in organization settings first`,
				});
			}
		}
		const next = { ...settings, channels };
		await db.transaction(async (tx) => {
			await tx
				.update(tables.organization)
				.set({ complianceAlertSettings: next })
				.where(eq(tables.organization.id, organizationId));
			await tx
				.delete(tables.complianceAlertRecipient)
				.where(
					and(
						eq(tables.complianceAlertRecipient.organizationId, organizationId),
						recipients.length
							? notInArray(tables.complianceAlertRecipient.userId, recipients)
							: undefined,
					),
				);
			if (recipients.length) {
				await tx
					.insert(tables.complianceAlertRecipient)
					.values(recipients.map((userId) => ({ organizationId, userId })))
					.onConflictDoNothing();
			}
		});
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "compliance_alert.settings_update",
			resourceType: "compliance_alert",
			resourceId: organizationId,
			metadata: {
				changes: {
					settings: { old: organization.complianceAlertSettings, new: next },
				},
			},
		});
		return c.json(next);
	},
);
