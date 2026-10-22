import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { cachedPublicResponse } from "@/lib/public-response-cache.js";
import { createRoute } from "@/utils/create-route.js";

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
import { models as modelDefinitions } from "@llmgateway/models";

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

// Ratings are public and unauthenticated; a rating write invalidates its
// model's entry, so the interval only bounds how often reads reach Postgres.
const RATINGS_REFRESH_MS = 60 * 1000;
const catalogueModelIds = new Set<string>(modelDefinitions.map((m) => m.id));

export function modelRatingsCacheKey(modelId: string): string {
	return `model-ratings:${modelId}`;
}

publicModelRatings.openapi(getModelRatings, async (c) => {
	const { modelId } = c.req.valid("query");
	// Ratings can only be written for catalogue models, so any other id has
	// none; answering without a lookup keeps arbitrary ids from creating cache
	// entries or queries.
	if (!catalogueModelIds.has(modelId)) {
		return c.json({ ratingCount: 0, averageRating: null, reviews: [] }, 200);
	}
	return c.json(
		await cachedPublicResponse(
			modelRatingsCacheKey(modelId),
			{ refreshAfterMs: RATINGS_REFRESH_MS },
			async () => await loadModelRatings(modelId),
		),
		200,
	);
});

async function loadModelRatings(modelId: string) {
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

	return {
		ratingCount,
		averageRating,
		reviews: reviews.map((r) => ({
			rating: r.rating,
			comment: r.comment ?? "",
			authorName: r.authorName ?? "LLM Gateway user",
			createdAt: r.createdAt.toISOString(),
		})),
	};
}

export { publicModelRatings };
