import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";
import type { OrganizationEmailPreferences } from "@llmgateway/db";
import type { Context } from "hono";

export const emailPreferences = new OpenAPIHono<ServerTypes>();

/** Both categories are on until someone turns them off. */
const DEFAULT_PREFERENCES = {
	marketing: true,
	creditAlerts: true,
} satisfies OrganizationEmailPreferences;

const orgParams = z.object({ organizationId: z.string() });

const preferencesSchema = z.object({
	marketing: z.boolean(),
	creditAlerts: z.boolean(),
});

async function assertOrgAccess(
	c: Context<ServerTypes>,
	organizationId: string,
	options: { manage?: boolean } = {},
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
			message:
				"Only organization owners and admins can manage email preferences",
		});
	}
	return { user, organization: membership.organization };
}

emailPreferences.openapi(
	createRoute({
		method: "get",
		path: "/{organizationId}/email-preferences",
		request: { params: orgParams },
		responses: {
			200: {
				description: "Organization email preferences",
				content: {
					"application/json": {
						schema: z.object({ preferences: preferencesSchema }),
					},
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const { organization } = await assertOrgAccess(c, organizationId);

		return c.json({
			preferences: organization.emailPreferences ?? DEFAULT_PREFERENCES,
		});
	},
);

emailPreferences.openapi(
	createRoute({
		method: "patch",
		path: "/{organizationId}/email-preferences",
		request: {
			params: orgParams,
			body: {
				content: {
					"application/json": { schema: preferencesSchema.partial() },
				},
			},
		},
		responses: {
			200: {
				description: "Updated organization email preferences",
				content: {
					"application/json": {
						schema: z.object({ preferences: preferencesSchema }),
					},
				},
			},
		},
	}),
	async (c) => {
		const { organizationId } = c.req.valid("param");
		const update = c.req.valid("json");
		const { user, organization } = await assertOrgAccess(c, organizationId, {
			manage: true,
		});

		const oldPreferences = organization.emailPreferences ?? DEFAULT_PREFERENCES;
		const preferences: OrganizationEmailPreferences = {
			...oldPreferences,
			...update,
		};

		await db
			.update(tables.organization)
			.set({ emailPreferences: preferences })
			.where(eq(tables.organization.id, organizationId));

		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "organization.email_preferences.update",
			resourceType: "organization",
			resourceId: organizationId,
			metadata: {
				changes: {
					emailPreferences: { old: oldPreferences, new: preferences },
				},
			},
		});

		return c.json({ preferences });
	},
);
