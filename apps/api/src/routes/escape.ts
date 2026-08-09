import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { userHasOrganizationAccess } from "@/utils/authorization.js";
import { awardLoungePoints } from "@/utils/lounge-points.js";

import { db, tables } from "@llmgateway/db";
import {
	ESCAPE_DIRECTIONS,
	ESCAPE_MAX_MOVES,
	isValidLevelId,
	replayGame,
	scoreGame,
} from "@llmgateway/shared/sandbox-escape";

import type { ServerTypes } from "@/vars.js";
import type { Direction } from "@llmgateway/shared/sandbox-escape";

export const escape = new OpenAPIHono<ServerTypes>();

const runSchema = z.object({
	id: z.string(),
	levelId: z.number(),
	model: z.string(),
	outcome: z.enum(["escaped", "terminated", "timeout"]),
	steps: z.number(),
	par: z.number(),
	score: z.number(),
	cost: z.number(),
	createdAt: z.string(),
});

const postRun = createRoute({
	method: "post",
	path: "/runs",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						levelId: z.number().int(),
						model: z.string().min(1).max(200),
						moves: z
							.array(z.enum(ESCAPE_DIRECTIONS))
							.min(1)
							.max(ESCAPE_MAX_MOVES),
						usedModel: z.string().max(200).optional(),
						usedProvider: z.string().max(100).optional(),
						organizationId: z.string().optional(),
						promptTokens: z.number().int().min(0).optional(),
						completionTokens: z.number().int().min(0).optional(),
						cost: z.number().min(0).optional(),
						durationMs: z.number().int().min(0).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: z.object({ run: runSchema }) } },
			description:
				"The recorded run, with the outcome and score derived by replaying the submitted moves server-side.",
		},
		400: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "The level is unknown or the run has not finished.",
		},
		401: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Unauthorized.",
		},
		403: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "The caller is not a member of the billing organization.",
		},
	},
});

escape.openapi(postRun, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	if (!isValidLevelId(body.levelId)) {
		throw new HTTPException(400, { message: "Unknown level" });
	}

	if (
		body.organizationId &&
		!(await userHasOrganizationAccess(authUser.id, body.organizationId))
	) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// The browser reports what it thinks happened; the authoritative result comes
	// from replaying the moves against the deterministic engine here.
	const state = replayGame(body.levelId, body.moves as Direction[]);

	if (state.outcome === "running") {
		throw new HTTPException(400, {
			message: "The run has not finished yet",
		});
	}

	const { score } = scoreGame(state);

	const [run] = await db
		.insert(tables.sandboxEscapeRun)
		.values({
			userId: authUser.id,
			organizationId: body.organizationId ?? null,
			levelId: body.levelId,
			model: body.model,
			usedModel: body.usedModel ?? null,
			usedProvider: body.usedProvider ?? null,
			outcome: state.outcome,
			steps: state.step,
			par: state.par,
			score,
			moves: state.moves,
			promptTokens: body.promptTokens ?? 0,
			completionTokens: body.completionTokens ?? 0,
			cost: body.cost ?? 0,
			durationMs: body.durationMs ?? 0,
		})
		.returning();

	if (state.outcome === "escaped") {
		await awardLoungePoints(authUser.id, "sandbox_escape");
	}

	return c.json(
		{
			run: {
				id: run.id,
				levelId: run.levelId,
				model: run.model,
				outcome: run.outcome,
				steps: run.steps,
				par: run.par,
				score: run.score,
				cost: run.cost,
				createdAt: run.createdAt.toISOString(),
			},
		},
		200,
	);
});
