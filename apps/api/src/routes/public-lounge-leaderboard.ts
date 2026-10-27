import { z } from "zod";

import { cachedPublicResponse } from "@/lib/public-response-cache.js";
import { createRoute } from "@/utils/create-route.js";
import { getLoungeLevel } from "@/utils/lounge-points.js";
import { createRouter } from "@/utils/router.js";

import {
	and,
	asc,
	db,
	desc,
	eq,
	isNotNull,
	loungePointEvent,
	sql,
	user,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicLoungeLeaderboard = createRouter<ServerTypes>();

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

// Public and unauthenticated, and the ranking aggregates a year of usage, so
// the top 100 is computed by one caller at most every 5 minutes and every
// request is served a slice of it.
const LEADERBOARD_SIZE = 100;
const LEADERBOARD_REFRESH_MS = 5 * 60 * 1000;

publicLoungeLeaderboard.openapi(getLoungeLeaderboard, async (c) => {
	const { limit } = c.req.valid("query");
	const { entries } = await cachedPublicResponse(
		"lounge-leaderboard:top100",
		{ refreshAfterMs: LEADERBOARD_REFRESH_MS },
		async () => await loadLoungeLeaderboard(LEADERBOARD_SIZE),
	);
	return c.json({ entries: entries.slice(0, limit ?? 50) }, 200);
});

async function loadLoungeLeaderboard(take: number) {
	const totalPointsExpr = sql<number>`COALESCE(SUM(${loungePointEvent.points}), 0)`;
	// RANK() so tied totals share a rank, matching the rank users see on their
	// own profile (computeLoungeStats counts strictly-greater totals).
	const rankExpr = sql<number>`RANK() OVER (ORDER BY ${totalPointsExpr} DESC)`;

	const rankedRows = await db
		.select({
			userId: user.id,
			username: user.username,
			name: user.name,
			image: user.image,
			profileHidePicture: user.profileHidePicture,
			points: totalPointsExpr.as("points"),
			rank: rankExpr.as("rank"),
		})
		.from(user)
		.innerJoin(loungePointEvent, eq(loungePointEvent.userId, user.id))
		.where(
			and(
				eq(user.profilePublic, true),
				isNotNull(user.username),
				eq(user.status, "active"),
			),
		)
		.groupBy(
			user.id,
			user.username,
			user.name,
			user.image,
			user.profileHidePicture,
		)
		.orderBy(desc(totalPointsExpr), asc(user.username))
		.limit(take);

	const entries = rankedRows
		.filter((row) => row.username !== null)
		.map((row) => {
			const points = Number(row.points);
			const { level, title } = getLoungeLevel(points);
			return {
				rank: Number(row.rank),
				username: row.username as string,
				name: row.name,
				image: row.profileHidePicture ? null : row.image,
				points,
				level,
				levelTitle: title,
			};
		});

	return { entries };
}
