import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import {
	DEFAULT_BYTEPLUS_ASSET_PROJECT,
	DEFAULT_BYTEPLUS_ASSET_REGION,
	encryptAssetCredentials,
	resolvePlatformPortraitBinding,
} from "@llmgateway/actions";
import { and, asc, db, eq, inArray, shortid, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

/**
 * BytePlus access key pairs for LLM Gateway's own ByteDance credentials, used
 * by organizations that verify portraits on credits.
 */
export const adminPortraitCredentials = new OpenAPIHono<ServerTypes>();

adminPortraitCredentials.use("/*", adminMiddleware);

const managedKeySchema = z.object({
	id: z.string(),
	// Only default-variant, all-region credentials can host portraits.
	eligible: z.boolean(),
	comment: z.string().nullable(),
	tokenMasked: z.string(),
	status: z.string().nullable(),
	hasAssetCredentials: z.boolean(),
	accessKeyIdMasked: z.string().nullable(),
	projectName: z.string().nullable(),
	region: z.string().nullable(),
});

const listRoute = createRoute({
	method: "get",
	path: "/portrait-credentials",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						managedKeys: z.array(managedKeySchema),
						// Which credential new platform portraits bind to.
						activeBinding: z
							.object({ providerKeyId: z.string().nullable() })
							.nullable(),
						portraitCount: z.number(),
					}),
				},
			},
			description: "Platform BytePlus asset credentials.",
		},
	},
});

adminPortraitCredentials.openapi(listRoute, async (c) => {
	const rows = await db
		.select({
			key: tables.providerKey,
			credential: tables.providerKeyAssetCredential,
		})
		.from(tables.providerKey)
		.leftJoin(
			tables.providerKeyAssetCredential,
			eq(
				tables.providerKeyAssetCredential.providerKeyId,
				tables.providerKey.id,
			),
		)
		.where(
			and(
				eq(tables.providerKey.managed, true),
				eq(tables.providerKey.provider, "bytedance"),
				inArray(tables.providerKey.status, ["active", "inactive"]),
			),
		)
		.orderBy(asc(tables.providerKey.createdAt));
	const binding = await resolvePlatformPortraitBinding();
	const platformGroups = await db
		.select({ id: tables.portraitGroup.id })
		.from(tables.portraitGroup)
		.where(eq(tables.portraitGroup.credentialSource, "platform"));
	return c.json({
		managedKeys: rows.map(({ key, credential }) => ({
			id: key.id,
			eligible: key.variant === "default" && key.region === null,
			comment: key.comment,
			tokenMasked: key.tokenMasked,
			status: key.status,
			hasAssetCredentials: credential !== null,
			accessKeyIdMasked: credential?.accessKeyIdMasked ?? null,
			projectName: credential?.projectName ?? null,
			region: credential?.region ?? null,
		})),
		activeBinding: binding ? { providerKeyId: binding.providerKeyId } : null,
		portraitCount: platformGroups.length,
	});
});

async function requireManagedBytedanceKey(id: string) {
	const key = await db.query.providerKey.findFirst({
		where: { id: { eq: id } },
	});
	if (
		!key ||
		!key.managed ||
		key.provider !== "bytedance" ||
		key.status === "deleted" ||
		key.status === "pending_deletion"
	) {
		throw new HTTPException(404, {
			message: "Managed ByteDance credential not found",
		});
	}
	return key;
}

const setRoute = createRoute({
	method: "put",
	path: "/portrait-credentials/{providerKeyId}",
	request: {
		params: z.object({ providerKeyId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						accessKeyId: z.string().trim().min(8).max(256),
						secretAccessKey: z.string().trim().min(8).max(512),
						projectName: z
							.string()
							.trim()
							.min(1)
							.max(64)
							.regex(/^[A-Za-z0-9_.-]+$/)
							.optional(),
						region: z
							.string()
							.trim()
							.regex(/^[a-z]{2}-[a-z]+-\d$/)
							.optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.boolean() }) },
			},
			description: "Access key pair stored.",
		},
	},
});

adminPortraitCredentials.openapi(setRoute, async (c) => {
	const { providerKeyId } = c.req.valid("param");
	const body = c.req.valid("json");
	const key = await requireManagedBytedanceKey(providerKeyId);
	const existing = await db.query.providerKeyAssetCredential.findFirst({
		where: { providerKeyId: { eq: key.id } },
	});
	const id = existing?.id ?? shortid();
	const values = {
		...encryptAssetCredentials(
			{ accessKeyId: body.accessKeyId, secretAccessKey: body.secretAccessKey },
			id,
			null,
		),
		projectName: body.projectName ?? DEFAULT_BYTEPLUS_ASSET_PROJECT,
		region: body.region ?? DEFAULT_BYTEPLUS_ASSET_REGION,
	};
	if (existing) {
		await db
			.update(tables.providerKeyAssetCredential)
			.set(values)
			.where(eq(tables.providerKeyAssetCredential.id, id));
	} else {
		await db.insert(tables.providerKeyAssetCredential).values({
			id,
			providerKeyId: key.id,
			organizationId: null,
			...values,
		});
	}
	logger.info("Platform BytePlus asset credentials updated", {
		providerKeyId: key.id,
		adminUserId: c.get("user")?.id,
	});
	return c.json({ success: true });
});

const deleteRoute = createRoute({
	method: "delete",
	path: "/portrait-credentials/{providerKeyId}",
	request: { params: z.object({ providerKeyId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ success: z.boolean() }) },
			},
			description: "Access key pair removed.",
		},
	},
});

adminPortraitCredentials.openapi(deleteRoute, async (c) => {
	const key = await requireManagedBytedanceKey(
		c.req.valid("param").providerKeyId,
	);
	await db
		.delete(tables.providerKeyAssetCredential)
		.where(eq(tables.providerKeyAssetCredential.providerKeyId, key.id));
	logger.info("Platform BytePlus asset credentials removed", {
		providerKeyId: key.id,
		adminUserId: c.get("user")?.id,
	});
	return c.json({ success: true });
});
