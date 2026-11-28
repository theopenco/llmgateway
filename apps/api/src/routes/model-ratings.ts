import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { invalidatePublicResponse } from "@/lib/public-response-cache.js";
import { modelRatingsCacheKey } from "@/routes/public-model-ratings.js";
import { createRoute } from "@/utils/create-route.js";

import { and, db, eq, rootModelIdSql, sql, tables } from "@llmgateway/db";
import { models as modelDefinitions } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const modelRatings = new OpenAPIHono<ServerTypes>();

// Users must have made at least this many requests on a model before they are
// allowed to rate it, to keep ratings tied to genuine usage.
const MINIMUM_REQUESTS_TO_RATE = 100;

// Counts the requests made on a model through API keys the user created. Uses
// the persisted hourly rollups rather than raw logs, since raw logs are subject
// to data-retention cleanup.
async function getModelRequestCount(
	userId: string,
	modelId: string,
): Promise<number> {
	const [result] = await db
		.select({
			value: sql<number>`COALESCE(SUM(${tables.apiKeyHourlyModelStats.requestCount}), 0)`,
		})
		.from(tables.apiKeyHourlyModelStats)
		.innerJoin(
			tables.apiKey,
			eq(tables.apiKey.id, tables.apiKeyHourlyModelStats.apiKeyId),
		)
		.where(
			and(
				eq(tables.apiKey.createdBy, userId),
				eq(rootModelIdSql(tables.apiKeyHourlyModelStats.usedModel), modelId),
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
	await invalidatePublicResponse(modelRatingsCacheKey(modelId));

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
	await invalidatePublicResponse(modelRatingsCacheKey(modelId));

	return c.json({ message: "ok" });
});
