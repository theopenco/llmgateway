import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { cachedPublicResponse } from "@/lib/public-response-cache.js";
import { CODING_AGENT_SOURCES } from "@/utils/profile.js";

import {
	and,
	db,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	ne,
	organization,
	project,
	projectHourlySourceStats,
	projectHourlyStats,
	sql,
	user,
	userOrganization,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicLeaderboard = new OpenAPIHono<ServerTypes>();

const leaderboardEntrySchema = z.object({
	rank: z.number(),
	username: z.string(),
	name: z.string().nullable(),
	image: z.string().nullable(),
	totalTokens: z.number(),
	totalRequests: z.number(),
	topAgent: z.string().nullable(),
});

const leaderboardSchema = z.object({
	entries: z.array(leaderboardEntrySchema),
});

const getLeaderboard = createRoute({
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
					schema: leaderboardSchema,
				},
			},
			description:
				"Public DevPass profiles ranked by total tokens routed over the last year.",
		},
	},
});

// Public and unauthenticated, and the ranking aggregates a year of usage, so
// the top 100 is computed by one caller at most every 5 minutes and every
// request is served a slice of it.
const LEADERBOARD_SIZE = 100;
const LEADERBOARD_REFRESH_MS = 5 * 60 * 1000;

publicLeaderboard.openapi(getLeaderboard, async (c) => {
	const { limit } = c.req.valid("query");
	const { entries } = await cachedPublicResponse(
		"devpass-leaderboard:top100",
		{ refreshAfterMs: LEADERBOARD_REFRESH_MS },
		async () => await loadLeaderboard(LEADERBOARD_SIZE),
	);
	return c.json({ entries: entries.slice(0, limit ?? 50) }, 200);
});

async function loadLeaderboard(take: number) {
	const startDate = new Date();
	startDate.setUTCHours(0, 0, 0, 0);
	startDate.setUTCDate(startDate.getUTCDate() - 364);

	const totalTokensExpr = sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`;

	const rankedRows = await db
		.select({
			userId: user.id,
			username: user.username,
			name: user.name,
			image: user.image,
			profileHidePicture: user.profileHidePicture,
			totalTokens: totalTokensExpr.as("totalTokens"),
			totalRequests:
				sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
					"totalRequests",
				),
		})
		.from(user)
		.innerJoin(userOrganization, eq(userOrganization.userId, user.id))
		.innerJoin(
			organization,
			and(
				eq(organization.id, userOrganization.organizationId),
				eq(organization.kind, "devpass"),
				ne(organization.devPlan, "none"),
			),
		)
		.innerJoin(
			project,
			and(
				eq(project.organizationId, organization.id),
				ne(project.status, "deleted"),
			),
		)
		.innerJoin(
			projectHourlyStats,
			and(
				eq(projectHourlyStats.projectId, project.id),
				gte(projectHourlyStats.hourTimestamp, startDate),
			),
		)
		.where(and(eq(user.profilePublic, true), isNotNull(user.username)))
		.groupBy(
			user.id,
			user.username,
			user.name,
			user.image,
			user.profileHidePicture,
		)
		.orderBy(desc(totalTokensExpr))
		.limit(take);

	const rankedUsers = rankedRows.filter((r) => r.username !== null);
	const userIds = rankedUsers.map((r) => r.userId);

	const topAgentByUser = new Map<string, string>();
	if (userIds.length > 0) {
		const agentRows = await db
			.select({
				userId: user.id,
				source: projectHourlySourceStats.source,
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlySourceStats.requestCount}), 0)`.as(
						"requestCount",
					),
			})
			.from(user)
			.innerJoin(userOrganization, eq(userOrganization.userId, user.id))
			.innerJoin(
				organization,
				and(
					eq(organization.id, userOrganization.organizationId),
					eq(organization.kind, "devpass"),
				),
			)
			.innerJoin(
				project,
				and(
					eq(project.organizationId, organization.id),
					ne(project.status, "deleted"),
				),
			)
			.innerJoin(
				projectHourlySourceStats,
				eq(projectHourlySourceStats.projectId, project.id),
			)
			.where(
				and(
					inArray(user.id, userIds),
					inArray(projectHourlySourceStats.source, CODING_AGENT_SOURCES),
				),
			)
			.groupBy(user.id, projectHourlySourceStats.source);

		const bestByUser = new Map<string, { source: string; count: number }>();
		for (const row of agentRows) {
			const count = Number(row.requestCount);
			const current = bestByUser.get(row.userId);
			if (!current || count > current.count) {
				bestByUser.set(row.userId, { source: row.source, count });
			}
		}
		for (const [id, best] of bestByUser) {
			topAgentByUser.set(id, best.source);
		}
	}

	const entries = rankedUsers.map((row, index) => ({
		rank: index + 1,
		username: row.username as string,
		name: row.name,
		image: row.profileHidePicture ? null : row.image,
		totalTokens: Number(row.totalTokens),
		totalRequests: Number(row.totalRequests),
		topAgent: topAgentByUser.get(row.userId) ?? null,
	}));

	return { entries };
}
