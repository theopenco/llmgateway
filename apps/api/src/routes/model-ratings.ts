import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, inArray, sql, tables } from "@llmgateway/db";
import { models as modelDefinitions } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const modelRatings = new OpenAPIHono<ServerTypes>();

// Users must have made at least this many requests on a model before they are
// allowed to rate it, to keep ratings tied to genuine usage.
const MINIMUM_REQUESTS_TO_RATE = 100;

// Counts how many requests a user has made on a given model across all the
// organizations they belong to. Uses the persisted hourly model stats rollups
// rather than raw logs, since raw logs are subject to data-retention cleanup.
// The model name may be stored as "provider/model" or just "model", so we match
// the model portion.
async function getModelRequestCount(
	userId: string,
	modelId: string,
): Promise<number> {
	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId },
		columns: { organizationId: true },
	});
	const organizationIds = userOrgs.map((o) => o.organizationId);
	if (organizationIds.length === 0) {
		return 0;
	}

	const projects = await db.query.project.findMany({
		where: { organizationId: { in: organizationIds } },
		columns: { id: true },
	});
	const projectIds = projects.map((p) => p.id);
	if (projectIds.length === 0) {
		return 0;
	}

	const [result] = await db
		.select({
			value: sql<number>`COALESCE(SUM(${tables.projectHourlyModelStats.requestCount}), 0)`,
		})
		.from(tables.projectHourlyModelStats)
		.where(
			and(
				inArray(tables.projectHourlyModelStats.projectId, projectIds),
				sql`CASE WHEN ${tables.projectHourlyModelStats.usedModel} LIKE '%/%'
					THEN SPLIT_PART(SPLIT_PART(${tables.projectHourlyModelStats.usedModel}, '/', 2), ':', 1)
					ELSE SPLIT_PART(${tables.projectHourlyModelStats.usedModel}, ':', 1)
				END = ${modelId}`,
			),
		);

	return Number(result?.value ?? 0);
}

const ratingSchema = z.object({
	modelId: z.string(),
	rating: z.number().int().min(1).max(5),
	comment: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const eligibilitySchema = z.object({
	canRate: z.boolean(),
	requestCount: z.number().int(),
	minimumRequests: z.number().int(),
});

const getOwnRating = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({ modelId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rating: ratingSchema.nullable(),
						eligibility: eligibilitySchema,
					}),
				},
			},
			description: "The authenticated user's rating for the model.",
		},
	},
});

modelRatings.openapi(getOwnRating, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { modelId } = c.req.valid("query");
	const [row, requestCount] = await Promise.all([
		db.query.modelRating.findFirst({
			where: { userId: authUser.id, modelId },
		}),
		getModelRequestCount(authUser.id, modelId),
	]);

	return c.json({
		rating: row
			? {
					modelId: row.modelId,
					rating: row.rating,
					comment: row.comment,
					createdAt: row.createdAt.toISOString(),
					updatedAt: row.updatedAt.toISOString(),
				}
			: null,
		eligibility: {
			canRate: requestCount >= MINIMUM_REQUESTS_TO_RATE,
			requestCount,
			minimumRequests: MINIMUM_REQUESTS_TO_RATE,
		},
	});
});

const upsertRating = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						modelId: z.string(),
						rating: z.number().int().min(1).max(5),
						comment: z.string().trim().max(2000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ rating: ratingSchema }),
				},
			},
			description: "Rating created or updated.",
		},
	},
});

modelRatings.openapi(upsertRating, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { modelId, rating, comment } = c.req.valid("json");

	const modelExists = modelDefinitions.some((m) => m.id === modelId);
	if (!modelExists) {
		throw new HTTPException(404, { message: "Model not found" });
	}

	const requestCount = await getModelRequestCount(authUser.id, modelId);
	if (requestCount < MINIMUM_REQUESTS_TO_RATE) {
		throw new HTTPException(403, {
			message: `You need at least ${MINIMUM_REQUESTS_TO_RATE} requests on this model before you can rate it.`,
		});
	}

	const [row] = await db
		.insert(tables.modelRating)
		.values({
			userId: authUser.id,
			modelId,
			rating,
			comment: comment || null,
		})
		.onConflictDoUpdate({
			target: [tables.modelRating.userId, tables.modelRating.modelId],
			set: {
				rating,
				comment: comment || null,
				updatedAt: new Date(),
			},
		})
		.returning();

	return c.json({
		rating: {
			modelId: row.modelId,
			rating: row.rating,
			comment: row.comment,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		},
	});
});

const deleteRating = createRoute({
	method: "delete",
	path: "/",
	request: {
		query: z.object({ modelId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Rating removed.",
		},
	},
});

modelRatings.openapi(deleteRating, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { modelId } = c.req.valid("query");
	await db
		.delete(tables.modelRating)
		.where(
			and(
				eq(tables.modelRating.userId, authUser.id),
				eq(tables.modelRating.modelId, modelId),
			),
		);

	return c.json({ message: "ok" });
});
