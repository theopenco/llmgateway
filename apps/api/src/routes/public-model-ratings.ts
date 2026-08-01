import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	and,
	avg,
	count,
	db,
	desc,
	eq,
	isNotNull,
	ne,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const publicModelRatings = new OpenAPIHono<ServerTypes>();

const reviewSchema = z.object({
	rating: z.number().int().min(1).max(5),
	comment: z.string(),
	authorName: z.string(),
	createdAt: z.string().datetime(),
});

const getModelRatings = createRoute({
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
						ratingCount: z.number().int(),
						averageRating: z.number().nullable(),
						reviews: z.array(reviewSchema),
					}),
				},
			},
			description: "Aggregate rating and recent reviews for a model.",
		},
	},
});

publicModelRatings.openapi(getModelRatings, async (c) => {
	const { modelId } = c.req.valid("query");

	const [aggregate] = await db
		.select({
			ratingCount: count(),
			averageRating: avg(tables.modelRating.rating),
		})
		.from(tables.modelRating)
		.where(eq(tables.modelRating.modelId, modelId));

	const reviews = await db
		.select({
			rating: tables.modelRating.rating,
			comment: tables.modelRating.comment,
			createdAt: tables.modelRating.createdAt,
			authorName: tables.user.name,
		})
		.from(tables.modelRating)
		.innerJoin(tables.user, eq(tables.modelRating.userId, tables.user.id))
		.where(
			and(
				eq(tables.modelRating.modelId, modelId),
				isNotNull(tables.modelRating.comment),
				ne(tables.modelRating.comment, ""),
			),
		)
		.orderBy(desc(tables.modelRating.createdAt))
		.limit(10);

	const ratingCount = aggregate?.ratingCount ?? 0;
	const averageRating = aggregate?.averageRating
		? Math.round(Number(aggregate.averageRating) * 10) / 10
		: null;

	return c.json(
		{
			ratingCount,
			averageRating,
			reviews: reviews.map((r) => ({
				rating: r.rating,
				comment: r.comment ?? "",
				authorName: r.authorName ?? "LLM Gateway user",
				createdAt: r.createdAt.toISOString(),
			})),
		},
		200,
	);
});

export { publicModelRatings };
