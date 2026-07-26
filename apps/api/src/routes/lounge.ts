import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	computeLoungeStats,
	loungeStatsSchema,
} from "@/utils/lounge-points.js";

import type { ServerTypes } from "@/vars.js";

export const lounge = new OpenAPIHono<ServerTypes>();

const getPointsMe = createRoute({
	method: "get",
	path: "/points/me",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ stats: loungeStatsSchema }),
				},
			},
			description:
				"The authenticated user's Lounge gamification stats: points, level, streaks, rank, and per-activity breakdown.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Unauthorized.",
		},
	},
});

lounge.openapi(getPointsMe, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const stats = await computeLoungeStats(authUser.id);

	return c.json({ stats }, 200);
});
