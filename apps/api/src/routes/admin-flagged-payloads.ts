import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware, getAdminRole } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import { logPlatformAuditEvent } from "@llmgateway/audit";
import {
	and,
	count,
	db,
	desc,
	eq,
	isNotNull,
	isNull,
	tables,
	type SQL,
} from "@llmgateway/db";
import { getReportedFlaggedPayloadExpiry } from "@llmgateway/shared/flagged-payload";
import { decryptFlaggedPayload } from "@llmgateway/shared/flagged-payload-crypto";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

/**
 * Trust & safety access to request payloads the gateway content filter
 * preserved (`content_filter_flagged_payload`). Full-access admins only — the
 * admin middleware refuses support and viewer on these paths, and every
 * handler checks again. Every access writes a platform audit entry first, so
 * nothing is returned without one.
 */
export const adminFlaggedPayloads = new OpenAPIHono<ServerTypes>();

adminFlaggedPayloads.use("/*", adminMiddleware);

const RESOURCE_TYPE = "content_filter_flagged_payload";
const payload = tables.contentFilterFlaggedPayload;

function requireFullAccessAdmin(c: Context<ServerTypes>) {
	const user = c.get("user");
	if (!user || getAdminRole(user) !== "admin") {
		throw new HTTPException(403, {
			message: "Flagged payloads require full admin access",
		});
	}
	return user;
}

const flaggedPayloadSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	requestId: z.string(),
	organizationId: z.string(),
	organizationName: z.string().nullable(),
	projectId: z.string(),
	apiKeyId: z.string(),
	endpoint: z.string(),
	provider: z.string(),
	model: z.string().nullable(),
	classifier: z.string(),
	tier: z.number(),
	level: z.string(),
	action: z.string(),
	matchedGroups: z.array(z.string()),
	matchedCategories: z.array(z.string()),
	categoryScores: z.record(z.string(), z.number()),
	payloadBytes: z.number(),
	payloadTruncated: z.boolean(),
	imageCount: z.number(),
	expiresAt: z.string(),
	reportedAt: z.string().nullable(),
	reportReference: z.string().nullable(),
	reportedByUserId: z.string().nullable(),
});

const payloadPartSchema = z.object({
	type: z.string(),
	text: z.string().optional(),
	url: z.string().optional(),
	urlSha256: z.string().optional(),
	sha256: z.string().optional(),
	mimeType: z.string().optional(),
	bytes: z.number().optional(),
	filename: z.string().optional(),
	fileId: z.string().optional(),
	name: z.string().optional(),
	input: z.unknown().optional(),
	content: z.unknown().optional(),
	originalType: z.string().optional(),
});

const decryptedPayloadSchema = z.object({
	version: z.number(),
	droppedMessages: z.number(),
	messages: z.array(
		z.object({
			role: z.string(),
			name: z.string().optional(),
			content: z.union([z.string(), z.array(payloadPartSchema)]),
			toolCalls: z
				.array(z.object({ name: z.string(), arguments: z.string() }))
				.optional(),
		}),
	),
});

const metadataColumns = {
	id: payload.id,
	createdAt: payload.createdAt,
	requestId: payload.requestId,
	organizationId: payload.organizationId,
	organizationName: tables.organization.name,
	projectId: payload.projectId,
	apiKeyId: payload.apiKeyId,
	endpoint: payload.endpoint,
	provider: payload.provider,
	model: payload.model,
	classifier: payload.classifier,
	tier: payload.tier,
	level: payload.level,
	action: payload.action,
	matchedGroups: payload.matchedGroups,
	matchedCategories: payload.matchedCategories,
	categoryScores: payload.categoryScores,
	payloadBytes: payload.payloadBytes,
	payloadTruncated: payload.payloadTruncated,
	imageCount: payload.imageCount,
	expiresAt: payload.expiresAt,
	reportedAt: payload.reportedAt,
	reportReference: payload.reportReference,
	reportedByUserId: payload.reportedByUserId,
};

type MetadataRow = Awaited<ReturnType<typeof findMetadata>>;

function serialize(row: MetadataRow): z.infer<typeof flaggedPayloadSchema> {
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
		reportedAt: row.reportedAt?.toISOString() ?? null,
	};
}

async function findMetadata(id: string) {
	const [row] = await db
		.select(metadataColumns)
		.from(payload)
		.leftJoin(
			tables.organization,
			eq(tables.organization.id, payload.organizationId),
		)
		.where(eq(payload.id, id))
		.limit(1);
	if (!row) {
		throw new HTTPException(404, { message: "Flagged payload not found" });
	}
	return row;
}

const listFlaggedPayloads = createRoute({
	method: "get",
	path: "/content-filter/flagged-payloads",
	request: {
		query: z.object({
			organizationId: z.string().optional(),
			reported: z.enum(["true", "false"]).optional(),
			limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().int().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						items: z.array(flaggedPayloadSchema),
						total: z.number(),
						limit: z.number(),
						offset: z.number(),
					}),
				},
			},
			description: "Preserved flagged payloads, newest first, metadata only.",
		},
	},
});

adminFlaggedPayloads.openapi(listFlaggedPayloads, async (c) => {
	const user = requireFullAccessAdmin(c);
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;

	const conditions: SQL[] = [];
	if (query.organizationId) {
		conditions.push(eq(payload.organizationId, query.organizationId));
	}
	if (query.reported === "true") {
		conditions.push(isNotNull(payload.reportedAt));
	} else if (query.reported === "false") {
		conditions.push(isNull(payload.reportedAt));
	}
	const where = conditions.length > 0 ? and(...conditions) : undefined;

	await logPlatformAuditEvent({
		userId: user.id,
		action: "content_filter_flagged_payload.list",
		resourceType: RESOURCE_TYPE,
		metadata: {
			actorEmail: user.email,
			...(query.organizationId ? { organizationId: query.organizationId } : {}),
			filters: {
				limit,
				offset,
				...(query.reported ? { reported: query.reported } : {}),
			},
		},
	});

	const [[totalRow], rows] = await Promise.all([
		db.select({ total: count() }).from(payload).where(where),
		db
			.select(metadataColumns)
			.from(payload)
			.leftJoin(
				tables.organization,
				eq(tables.organization.id, payload.organizationId),
			)
			.where(where)
			.orderBy(desc(payload.createdAt), desc(payload.id))
			.limit(limit)
			.offset(offset),
	]);

	return c.json({
		items: rows.map(serialize),
		total: totalRow?.total ?? 0,
		limit,
		offset,
	});
});

const getFlaggedPayload = createRoute({
	method: "get",
	path: "/content-filter/flagged-payloads/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						item: flaggedPayloadSchema,
						payload: decryptedPayloadSchema,
					}),
				},
			},
			description: "One flagged payload, decrypted. Audit-logged.",
		},
		404: { description: "Flagged payload not found." },
	},
});

adminFlaggedPayloads.openapi(getFlaggedPayload, async (c) => {
	const user = requireFullAccessAdmin(c);
	const { id } = c.req.valid("param");
	const item = await findMetadata(id);

	await logPlatformAuditEvent({
		userId: user.id,
		action: "content_filter_flagged_payload.view",
		resourceType: RESOURCE_TYPE,
		resourceId: id,
		metadata: { actorEmail: user.email, organizationId: item.organizationId },
	});

	const [row] = await db
		.select({ ciphertext: payload.payloadCiphertext })
		.from(payload)
		.where(eq(payload.id, id))
		.limit(1);
	if (!row) {
		throw new HTTPException(404, { message: "Flagged payload not found" });
	}
	const decrypted = decryptedPayloadSchema.parse(
		JSON.parse(decryptFlaggedPayload(row.ciphertext, id, item.organizationId)),
	);

	c.header("Cache-Control", "no-store");
	return c.json({ item: serialize(item), payload: decrypted });
});

const reportFlaggedPayload = createRoute({
	method: "post",
	path: "/content-filter/flagged-payloads/{id}/report",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// NCMEC CyberTipline report number or another reference.
						reportReference: z.string().trim().min(1).max(200),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: flaggedPayloadSchema }),
				},
			},
			description:
				"Marked as reported; kept for one year after the first report.",
		},
		404: { description: "Flagged payload not found." },
	},
});

adminFlaggedPayloads.openapi(reportFlaggedPayload, async (c) => {
	const user = requireFullAccessAdmin(c);
	const { id } = c.req.valid("param");
	const { reportReference } = c.req.valid("json");
	const existing = await findMetadata(id);

	await logPlatformAuditEvent({
		userId: user.id,
		action: "content_filter_flagged_payload.report",
		resourceType: RESOURCE_TYPE,
		resourceId: id,
		metadata: {
			actorEmail: user.email,
			organizationId: existing.organizationId,
			reportReference,
		},
	});

	// The first report date anchors the one-year hold; a later call only
	// updates the reference and never shortens the expiry.
	const reportedAt = existing.reportedAt ?? new Date();
	await db
		.update(payload)
		.set({
			reportedAt,
			reportReference,
			reportedByUserId: existing.reportedByUserId ?? user.id,
			expiresAt: getReportedFlaggedPayloadExpiry(
				reportedAt,
				existing.expiresAt,
			),
		})
		.where(eq(payload.id, id));

	return c.json({ item: serialize(await findMetadata(id)) });
});
