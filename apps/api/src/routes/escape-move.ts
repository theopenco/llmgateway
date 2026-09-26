import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { APICallError, generateText } from "ai";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { userHasProjectAccess } from "@/utils/authorization.js";
import {
	getOrCreatePlaygroundApiKey,
	PLAYGROUND_KEY_COOKIE_NAME,
	setPlaygroundKeyCookie,
} from "@/utils/playground-key.js";

import { createLLMGateway } from "@llmgateway/ai-sdk-provider";
import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getEscapeReasoningEffort } from "@llmgateway/shared/escape-reasoning";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";
import {
	applyMove,
	buildTurnPrompt,
	ESCAPE_DIRECTIONS,
	ESCAPE_MAX_MOVES,
	ESCAPE_SYSTEM_PROMPT,
	isValidLevelId,
	parseMoveResponse,
	replayGame,
} from "@llmgateway/shared/sandbox-escape";

import type { ServerTypes } from "@/vars.js";

const point = z.object({ x: z.number(), y: z.number() });
const stateSchema = z.object({
	levelId: z.number(),
	width: z.number(),
	height: z.number(),
	walls: z.array(z.boolean()),
	player: point,
	exit: point,
	shards: z.array(point),
	collected: z.number(),
	totalShards: z.number(),
	shells: z.array(point),
	daemons: z.array(
		point.extend({
			dx: z.number(),
			dy: z.number(),
			hunt: z.number(),
			cooldown: z.number(),
		}),
	),
	huntRadius: z.number(),
	frozenTurns: z.number(),
	step: z.number(),
	stepBudget: z.number(),
	par: z.number(),
	outcome: z.enum(["running", "escaped", "terminated", "timeout"]),
	lastEvent: z.string(),
	moves: z.array(z.enum(ESCAPE_DIRECTIONS)),
});
const errorResponse = {
	description: "Escape turn failed",
	content: {
		"application/json": { schema: z.object({ message: z.string() }) },
	},
};
const gatewayUsage = z.object({
	llmgateway: z
		.object({
			usage: z
				.object({
					promptTokens: z.number().finite().nonnegative().optional(),
					completionTokens: z.number().finite().nonnegative().optional(),
					cost: z.number().finite().nonnegative().optional(),
				})
				.optional(),
		})
		.optional(),
});

export const escapeMove = new OpenAPIHono<ServerTypes>();
escapeMove.openapi(
	createRoute({
		method: "post",
		path: "/move",
		tags: ["Lounge"],
		request: {
			body: {
				required: true,
				content: {
					"application/json": {
						schema: z
							.object({
								projectId: z.string().min(1),
								levelId: z
									.number()
									.int()
									.refine(isValidLevelId, "Unknown level"),
								moves: z.array(z.enum(ESCAPE_DIRECTIONS)).max(ESCAPE_MAX_MOVES),
								model: z.string().trim().min(1).max(255),
							})
							.strict(),
					},
				},
			},
		},
		responses: {
			200: {
				description: "One model turn applied to the replayed board",
				content: {
					"application/json": {
						schema: z.object({
							move: z.enum(ESCAPE_DIRECTIONS),
							thought: z.string(),
							understood: z.boolean(),
							state: stateSchema,
							usedModel: z.string().nullable(),
							usage: z.object({
								promptTokens: z.number(),
								completionTokens: z.number(),
								cost: z.number(),
								durationMs: z.number(),
							}),
						}),
					},
				},
			},
			400: errorResponse,
			401: errorResponse,
			402: errorResponse,
			403: errorResponse,
			404: errorResponse,
			429: errorResponse,
			502: errorResponse,
			504: errorResponse,
		},
	}),
	async (c) => {
		const user = c.get("user")!;
		const body = c.req.valid("json");
		const state = replayGame(body.levelId, body.moves);
		if (state.outcome !== "running") {
			throw new HTTPException(400, {
				message: "This run has already finished",
			});
		}
		const project = await db.query.project.findFirst({
			where: { id: { eq: body.projectId }, status: { eq: "active" } },
		});
		if (!project) {
			throw new HTTPException(404, { message: "Active project not found" });
		}
		if (!(await userHasProjectAccess(user.id, project.id))) {
			throw new HTTPException(403, {
				message: "You do not have access to this project",
			});
		}
		const key = await getOrCreatePlaygroundApiKey(
			project.id,
			user.id,
			c.req.header("x-llmgateway-key") ??
				getCookie(c, PLAYGROUND_KEY_COOKIE_NAME),
		);
		if (key.cookieNeedsRefresh) {
			setPlaygroundKeyCookie(c, key.token, key.cookieMaxAge);
		}
		const gateway = createLLMGateway({
			apiKey: key.token,
			baseURL: getGatewayApiBaseUrl(),
			headers: {
				"x-source": LOUNGE_SOURCE,
				...(body.model.includes("/") && { "x-no-fallback": "true" }),
			},
			extraBody: { reasoning_effort: getEscapeReasoningEffort(body.model) },
		});
		const signal = AbortSignal.any([
			c.req.raw.signal,
			AbortSignal.timeout(120_000),
		]);
		const started = Date.now();
		let result: Awaited<ReturnType<typeof generateText>>;
		try {
			signal.throwIfAborted();
			result = await generateText({
				model: gateway.chat(body.model, { usage: { include: true } }),
				instructions: ESCAPE_SYSTEM_PROMPT,
				messages: [{ role: "user", content: buildTurnPrompt(state) }],
				maxOutputTokens: 2048,
				maxRetries: 0,
				abortSignal: signal,
			});
		} catch (error) {
			if (APICallError.isInstance(error) && error.statusCode === 402) {
				throw new HTTPException(402, {
					message:
						"Your Lounge allowance is used up. Manage your membership on the website.",
				});
			}
			if (APICallError.isInstance(error) && error.statusCode === 429) {
				throw new HTTPException(429, {
					message: "Too many model requests. Try again shortly.",
				});
			}
			if (
				error instanceof Error &&
				["TimeoutError", "AbortError"].includes(error.name)
			) {
				throw new HTTPException(504, {
					message: "The turn was interrupted or timed out. Try again.",
				});
			}
			logger.error("Escape model turn failed", error);
			throw new HTTPException(502, {
				message: "The model could not take a turn. Try again.",
			});
		}
		const parsed = parseMoveResponse(result.text);
		const move = parsed?.move ?? "wait";
		const usage = gatewayUsage.safeParse(result.providerMetadata);
		const billed = usage.success ? usage.data.llmgateway?.usage : undefined;
		return c.json(
			{
				move,
				thought: parsed?.thought ?? "",
				understood: parsed !== null,
				state: applyMove(state, move),
				usedModel: result.response?.modelId ?? null,
				usage: {
					promptTokens: billed?.promptTokens ?? result.usage.inputTokens ?? 0,
					completionTokens:
						billed?.completionTokens ?? result.usage.outputTokens ?? 0,
					cost: billed?.cost ?? 0,
					durationMs: Date.now() - started,
				},
			},
			200,
		);
	},
);
