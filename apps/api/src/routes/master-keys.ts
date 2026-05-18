import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "@/lib/maskToken.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, shortid, tables } from "@llmgateway/db";
import {
	getApiKeyFingerprint,
	getMasterKeyPrefix,
} from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";

export const masterKeys = new OpenAPIHono<ServerTypes>();

export const MAX_MASTER_KEYS_PER_ORG = 10;

async function assertEnterpriseOrgAccess(
	userId: string,
	organizationId: string,
): Promise<{ role: "owner" | "admin" }> {
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		with: { organization: true },
	});

	if (!userOrg || userOrg.organization?.status === "deleted") {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage master keys",
		});
	}

	if (userOrg.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Master keys require an enterprise plan",
		});
	}

	return { role: userOrg.role };
}

const masterKeySchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	maskedToken: z.string(),
	description: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	lastUsedAt: z.date().nullable(),
	organizationId: z.string(),
	createdBy: z.string(),
	creator: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string(),
		})
		.nullable()
		.optional(),
});

const createMasterKeySchema = z.object({
	description: z.string().trim().min(1).max(255),
	organizationId: z.string().trim().min(1),
});

const listQuerySchema = z.object({
	organizationId: z.string().min(1).openapi({
		description: "Organization ID to list master keys for",
	}),
});

const updateStatusSchema = z.object({
	status: z.enum(["active", "inactive"]),
});

const create = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createMasterKeySchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						masterKey: masterKeySchema
							.extend({
								token: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description:
				"Master key created successfully. The plain token is included in the response and will not be retrievable again.",
		},
	},
});

masterKeys.openapi(create, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { description, organizationId } = c.req.valid("json");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const existingKeys = await db.query.masterKey.findMany({
		where: {
			organizationId: { eq: organizationId },
			status: { ne: "deleted" },
		},
		columns: { id: true },
	});

	if (existingKeys.length >= MAX_MASTER_KEYS_PER_ORG) {
		throw new HTTPException(400, {
			message: `Master key limit reached. Maximum ${MAX_MASTER_KEYS_PER_ORG} master keys per organization. Contact us at contact@llmgateway.io to unlock more.`,
		});
	}

	const token = getMasterKeyPrefix() + shortid(40);
	const tokenHash = getApiKeyFingerprint(token);
	const maskedToken = maskToken(token);

	const [created] = await db
		.insert(tables.masterKey)
		.values({
			tokenHash,
			maskedToken,
			description,
			organizationId,
			createdBy: user.id,
		})
		.returning({
			id: tables.masterKey.id,
			createdAt: tables.masterKey.createdAt,
			updatedAt: tables.masterKey.updatedAt,
			maskedToken: tables.masterKey.maskedToken,
			description: tables.masterKey.description,
			status: tables.masterKey.status,
			lastUsedAt: tables.masterKey.lastUsedAt,
			organizationId: tables.masterKey.organizationId,
			createdBy: tables.masterKey.createdBy,
		});

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "master_key.create",
		resourceType: "master_key",
		resourceId: created.id,
		metadata: { resourceName: description },
	});

	return c.json(
		{
			masterKey: {
				...created,
				token,
			},
		},
		201,
	);
});

const list = createRoute({
	method: "get",
	path: "/",
	request: {
		query: listQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						masterKeys: z.array(masterKeySchema).openapi({}),
						planLimits: z.object({
							currentCount: z.number(),
							maxKeys: z.number(),
						}),
					}),
				},
			},
			description: "List of master keys for the organization.",
		},
	},
});

masterKeys.openapi(list, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");

	await assertEnterpriseOrgAccess(user.id, organizationId);

	const rows = await db.query.masterKey.findMany({
		where: {
			organizationId: { eq: organizationId },
			status: { ne: "deleted" },
		},
		columns: { tokenHash: false },
		with: {
			creator: {
				columns: { id: true, name: true, email: true },
			},
		},
		orderBy: { createdAt: "desc" },
	});

	return c.json({
		masterKeys: rows,
		planLimits: {
			currentCount: rows.length,
			maxKeys: MAX_MASTER_KEYS_PER_ORG,
		},
	});
});

const updateStatus = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateStatusSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						masterKey: masterKeySchema.openapi({}),
					}),
				},
			},
			description: "Master key status updated successfully.",
		},
	},
});

masterKeys.openapi(updateStatus, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const { status } = c.req.valid("json");

	const existing = await db.query.masterKey.findFirst({
		where: { id: { eq: id }, status: { ne: "deleted" } },
		columns: { tokenHash: false },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Master key not found" });
	}

	await assertEnterpriseOrgAccess(user.id, existing.organizationId);

	const [updated] = await db
		.update(tables.masterKey)
		.set({ status })
		.where(eq(tables.masterKey.id, id))
		.returning({
			id: tables.masterKey.id,
			createdAt: tables.masterKey.createdAt,
			updatedAt: tables.masterKey.updatedAt,
			maskedToken: tables.masterKey.maskedToken,
			description: tables.masterKey.description,
			status: tables.masterKey.status,
			lastUsedAt: tables.masterKey.lastUsedAt,
			organizationId: tables.masterKey.organizationId,
			createdBy: tables.masterKey.createdBy,
		});

	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "master_key.update_status",
		resourceType: "master_key",
		resourceId: id,
		metadata: {
			resourceName: existing.description,
			changes: { status: { old: existing.status, new: status } },
		},
	});

	return c.json({
		message: "Master key status updated successfully",
		masterKey: updated,
	});
});

const remove = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Master key deleted successfully.",
		},
	},
});

masterKeys.openapi(remove, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const existing = await db.query.masterKey.findFirst({
		where: { id: { eq: id }, status: { ne: "deleted" } },
		columns: { tokenHash: false },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Master key not found" });
	}

	await assertEnterpriseOrgAccess(user.id, existing.organizationId);

	await db
		.update(tables.masterKey)
		.set({ status: "deleted" })
		.where(eq(tables.masterKey.id, id));

	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: user.id,
		action: "master_key.delete",
		resourceType: "master_key",
		resourceId: id,
		metadata: { resourceName: existing.description },
	});

	return c.json({ message: "Master key deleted successfully" });
});

export default masterKeys;
