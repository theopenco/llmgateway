import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, tables } from "@llmgateway/db";
import { models as modelDefinitions } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const modelRatings = new OpenAPIHono<ServerTypes>();

const ratingSchema = z.object({
	modelId: z.string(),
	rating: z.number().int().min(1).max(5),
	comment: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
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
					schema: z.object({ rating: ratingSchema.nullable() }),
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
	const row = await db.query.modelRating.findFirst({
		where: { userId: authUser.id, modelId },
	});

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
