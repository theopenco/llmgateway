import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, sql, tables } from "@llmgateway/db";
import { getLevel, isValidLevelId } from "@llmgateway/shared/sandbox-escape";

import type { ServerTypes } from "@/vars.js";

export const publicEscape = new OpenAPIHono<ServerTypes>();

const leaderboardEntrySchema = z.object({
	rank: z.number(),
	model: z.string(),
	runs: z.number(),
	escapes: z.number(),
	successRate: z.number(),
	/** Mean score across every run, counting failures as zero. */
	avgScore: z.number(),
	bestScore: z.number(),
	/** Fewest steps in a successful run; null when the model never escaped. */
	bestSteps: z.number().nullable(),
	avgCost: z.number(),
});

const getLeaderboard = createRoute({
	method: "get",
	path: "/leaderboard",
	request: {
		query: z.object({
			levelId: z.coerce.number().int().optional(),
			limit: z.coerce.number().int().min(1).max(100).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						entries: z.array(leaderboardEntrySchema),
						totalRuns: z.number(),
						totalEscapes: z.number(),
					}),
				},
			},
			description:
				"Models ranked by how well they escape the sandbox, aggregated over every recorded run.",
		},
	},
});

publicEscape.openapi(getLeaderboard, async (c) => {
	const { levelId, limit } = c.req.valid("query");
	const take = limit ?? 25;

	const runs = tables.sandboxEscapeRun;
	const escapedExpr = sql<number>`COUNT(*) FILTER (WHERE ${runs.outcome} = 'escaped')`;
	const bestStepsExpr = sql<
		number | null
	>`MIN(${runs.steps}) FILTER (WHERE ${runs.outcome} = 'escaped')`;

	const rows = await db
		.select({
			model: runs.model,
			runs: sql<number>`COUNT(*)`,
			escapes: escapedExpr,
			avgScore: sql<number>`AVG(${runs.score})`,
			bestScore: sql<number>`MAX(${runs.score})`,
			bestSteps: bestStepsExpr,
			avgCost: sql<number>`AVG(${runs.cost})`,
		})
		.from(runs)
		.where(
			levelId !== undefined && isValidLevelId(levelId)
				? eq(runs.levelId, levelId)
				: undefined,
		)
		.groupBy(runs.model)
		// Mean score already folds success rate and efficiency together: a failed
		// run scores zero, so a model that escapes often and quickly rises.
		.orderBy(sql`AVG(${runs.score}) DESC, COUNT(*) DESC`)
		.limit(take);

	const entries = rows.map((row, position) => {
		const total = Number(row.runs);
		const escapes = Number(row.escapes);
		return {
			rank: position + 1,
			model: row.model,
			runs: total,
			escapes,
			successRate: total > 0 ? escapes / total : 0,
			avgScore: Math.round(Number(row.avgScore ?? 0)),
			bestScore: Number(row.bestScore ?? 0),
			bestSteps: row.bestSteps === null ? null : Number(row.bestSteps),
			avgCost: Number(row.avgCost ?? 0),
		};
	});

	return c.json(
		{
			entries,
			totalRuns: entries.reduce((sum, entry) => sum + entry.runs, 0),
			totalEscapes: entries.reduce((sum, entry) => sum + entry.escapes, 0),
		},
		200,
	);
});

const getRun = createRoute({
	method: "get",
	path: "/runs/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						run: z.object({
							id: z.string(),
							levelId: z.number(),
							levelName: z.string(),
							levelSlug: z.string(),
							model: z.string(),
							usedModel: z.string().nullable(),
							usedProvider: z.string().nullable(),
							outcome: z.enum(["escaped", "terminated", "timeout"]),
							steps: z.number(),
							par: z.number(),
							score: z.number(),
							moves: z.array(z.string()),
							promptTokens: z.number(),
							completionTokens: z.number(),
							cost: z.number(),
							createdAt: z.string(),
						}),
					}),
				},
			},
			description:
				"A single recorded run, including its move list so the board can be replayed. No player identity is exposed.",
		},
		404: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "No such run.",
		},
	},
});

publicEscape.openapi(getRun, async (c) => {
	const { id } = c.req.valid("param");

	const [run] = await db
		.select()
		.from(tables.sandboxEscapeRun)
		.where(and(eq(tables.sandboxEscapeRun.id, id)))
		.limit(1);

	if (!run) {
		throw new HTTPException(404, { message: "Run not found" });
	}

	const level = getLevel(run.levelId);

	return c.json(
		{
			run: {
				id: run.id,
				levelId: run.levelId,
				levelName: level.name,
				levelSlug: level.slug,
				model: run.model,
				usedModel: run.usedModel,
				usedProvider: run.usedProvider,
				outcome: run.outcome,
				steps: run.steps,
				par: run.par,
				score: run.score,
				moves: run.moves,
				promptTokens: run.promptTokens,
				completionTokens: run.completionTokens,
				cost: run.cost,
				createdAt: run.createdAt.toISOString(),
			},
		},
		200,
	);
});
