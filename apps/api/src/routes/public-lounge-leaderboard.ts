import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { getLoungeLevel } from "@/utils/lounge-points.js";

import {
	and,
	db,
	desc,
	eq,
	isNotNull,
	loungePointEvent,
	sql,
	user,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicLoungeLeaderboard = new OpenAPIHono<ServerTypes>();

const loungeLeaderboardEntrySchema = z.object({
	rank: z.number(),
	username: z.string(),
	name: z.string().nullable(),
	image: z.string().nullable(),
	points: z.number(),
	level: z.number(),
	levelTitle: z.string(),
});

const loungeLeaderboardSchema = z.object({
	entries: z.array(loungeLeaderboardEntrySchema),
});

const getLoungeLeaderboard = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			limit: z.coerce.number().int().min(1).max(100).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: loungeLeaderboardSchema,
				},
			},
			description:
				"Public profiles ranked by total Lounge points. Only users who claimed a username and made their profile public appear.",
		},
	},
});

publicLoungeLeaderboard.openapi(getLoungeLeaderboard, async (c) => {
	const { limit } = c.req.valid("query");
	const take = limit ?? 50;

	const totalPointsExpr = sql<number>`COALESCE(SUM(${loungePointEvent.points}), 0)`;

	const rankedRows = await db
		.select({
			userId: user.id,
			username: user.username,
			name: user.name,
			image: user.image,
			profileHidePicture: user.profileHidePicture,
			points: totalPointsExpr.as("points"),
		})
		.from(user)
		.innerJoin(loungePointEvent, eq(loungePointEvent.userId, user.id))
		.where(and(eq(user.profilePublic, true), isNotNull(user.username)))
		.groupBy(
			user.id,
			user.username,
			user.name,
			user.image,
			user.profileHidePicture,
		)
		.orderBy(desc(totalPointsExpr))
		.limit(take);

	const entries = rankedRows
		.filter((row) => row.username !== null)
		.map((row, index) => {
			const points = Number(row.points);
			const { level, title } = getLoungeLevel(points);
			return {
				rank: index + 1,
				username: row.username as string,
				name: row.name,
				image: row.profileHidePicture ? null : row.image,
				points,
				level,
				levelTitle: title,
			};
		});

	return c.json({ entries }, 200);
});
