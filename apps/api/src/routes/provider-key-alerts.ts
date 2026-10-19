import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import {
	DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
	providerKeyAlertSettingsSchema,
} from "@llmgateway/shared/provider-key-alerts";

import { assertOrgAccess } from "./compliance-alerts.js";

import type { ServerTypes } from "@/vars.js";

export const providerKeyAlerts = new OpenAPIHono<ServerTypes>();

const orgParams = z.object({ organizationId: z.string() });

const responseSchema = z.object({
	settings: providerKeyAlertSettingsSchema,
	// False until an owner or admin saved the settings once.
	configured: z.boolean(),
});

providerKeyAlerts.openapi(
	createRoute({
		method: "get",
		path: "/{organizationId}/provider-key-alerts",
		request: { params: orgParams },
		responses: {
			200: {
				description: "Provider key error-rate alert settings",
				content: { "application/json": { schema: responseSchema } },
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { organization } = await assertOrgAccess(c, organizationId);
		return c.json({
			settings:
				organization.providerKeyAlertSettings ??
				DEFAULT_PROVIDER_KEY_ALERT_SETTINGS,
			configured: organization.providerKeyAlertSettings !== null,
		});
	},
);

providerKeyAlerts.openapi(
	createRoute({
		method: "put",
		path: "/{organizationId}/provider-key-alerts",
		request: {
			params: orgParams,
			body: {
				required: true,
				content: {
					"application/json": { schema: providerKeyAlertSettingsSchema },
				},
			},
		},
		responses: {
			200: {
				description: "Saved settings",
				content: { "application/json": { schema: responseSchema } },
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const settings = c.req.valid("json");
		const { user, organization } = await assertOrgAccess(c, organizationId, {
			manage: true,
		});
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
		if (settings.enabled && !settings.rules.some((rule) => rule.enabled)) {
			throw new HTTPException(400, {
				message: "Enable at least one rule or turn the alerts off",
			});
		}
		const next = { ...settings, channels };
		await db
			.update(tables.organization)
			.set({ providerKeyAlertSettings: next })
			.where(eq(tables.organization.id, organizationId));
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "provider_key_alert.settings_update",
			resourceType: "provider_key_alert",
			resourceId: organizationId,
			metadata: {
				changes: {
					settings: {
						old: organization.providerKeyAlertSettings ?? null,
						new: next,
					},
				},
			},
		});
		return c.json({ settings: next, configured: true });
	},
);
