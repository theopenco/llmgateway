import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { handleDecisionRequest } from "@/decisions/handle-decision-request.js";
import {
	rateLimitHeaders,
	standardErrorResponses,
} from "@/lib/error-schemas.js";

import { shortid } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * TypeSafe-compatible `/v1/systemone`. Kept for existing integrations and
 * serves TypeSafe models only; new decision models ship on the
 * OpenAI-compatible `/v1/decisions`.
 */

/** Free-form text, or JSON structure the questions can reference by key. */
const structuredTextSchema = z.union([
	z.string(),
	z.record(z.unknown()),
	z.array(z.unknown()),
]);

const instructionsSchema = structuredTextSchema.openapi({
	description:
		"What the model should decide. An object or array can hold the question in one field and the data it refers to in others.",
	example: "Does this message convey urgency?",
});

const noulQuestionSchema = z.object({
	type: z.literal("noul"),
	instructions: instructionsSchema,
	criteria: z
		.object({
			true: structuredTextSchema.optional(),
			false: structuredTextSchema.optional(),
		})
		.optional()
		.openapi({
			description: "Optional descriptions of what a yes and a no mean.",
		}),
});

const choiceQuestionSchema = z.object({
	type: z.literal("choice"),
	instructions: instructionsSchema,
	criteria: z
		.record(structuredTextSchema.nullable())
		.refine((criteria) => Object.keys(criteria).length >= 2, {
			message: "A choice question needs at least two options",
		})
		.refine((criteria) => Object.keys(criteria).length <= 255, {
			message: "A choice question accepts at most 255 options",
		})
		.openapi({
			description:
				"Option to rubric description. Use null for an option that needs no detail.",
		}),
});

const scoreQuestionSchema = z.object({
	type: z.literal("score"),
	instructions: instructionsSchema,
	criteria: z.array(structuredTextSchema).min(2).max(10).openapi({
		description: "Ordered level descriptions, lowest first. Two to ten levels.",
	}),
});

const questionSchema = z
	.discriminatedUnion("type", [
		noulQuestionSchema,
		choiceQuestionSchema,
		scoreQuestionSchema,
	])
	.openapi({
		description:
			"A typed question: `noul` (yes/no probability), `choice` (one option from a set) or `score` (rating across ordered levels).",
	});

const systemOneRequestSchema = z.object({
	model: z.string().openapi({
		description:
			"ID of the decision model to use. Optionally prefixed with a provider (`typesafe/…`).",
		example: "jev-1.13.0",
	}),
	state: structuredTextSchema.openapi({
		description:
			"The content to evaluate: plain text, or structured data such as a chat log or record.",
		example: "Our production integration has been returning 500s for 3 days.",
	}),
	questions: z
		.record(questionSchema)
		.refine((questions) => Object.keys(questions).length > 0, {
			message: "At least one question is required",
		})
		.openapi({
			description:
				"Questions keyed by an id you choose. Answers come back under the same ids.",
		}),
});

const systemOneAnswerSchema = z
	.object({
		type: z.enum(["noul", "choice", "score"]),
		noul: z.number().optional().openapi({
			description: "Yes/no answer from 0 (no) to 1 (yes), on a noul answer.",
		}),
		choice: z.string().optional().openapi({
			description: "Highest-probability option, on a choice answer.",
		}),
		score: z.number().optional().openapi({
			description:
				"Probability-weighted level, on a score answer. Can land between levels.",
		}),
		legend: z.record(z.string()).optional().openapi({
			description: "Level index to its description, on a score answer.",
		}),
		probabilities: z.record(z.number()).optional().openapi({
			description: "Probability per option or level; sums to 1.",
		}),
		confidence: z.number().optional().openapi({
			description:
				"How certain the model is, derived from the probability distribution.",
		}),
	})
	.passthrough();

const systemOneResponseSchema = z
	.object({
		model: z.string(),
		answers: z.record(systemOneAnswerSchema),
		usage: z
			.object({
				input_tokens: z.number().int().optional(),
				output_tokens: z.number().int().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough()
	.openapi({
		description: "One typed answer per question, keyed by the question ids.",
	});

/** Question ids and types, as a one-line summary for the request log. */
function summarizeQuestions(
	questions: Record<string, z.infer<typeof questionSchema>>,
): string {
	return Object.entries(questions)
		.map(([id, question]) => `${id} (${question.type})`)
		.join(", ");
}

function summarizeState(state: unknown): string {
	const text = typeof state === "string" ? state : JSON.stringify(state);
	return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

export const systemone = new OpenAPIHono<ServerTypes>();

const createSystemOne = createRoute({
	operationId: "v1_systemone",
	summary: "System One",
	description:
		"Evaluate a state against named typed questions and get calibrated yes/no, choice and score answers back. TypeSafe-compatible API, serving TypeSafe models only. To be deprecated soon in favor of the OpenAI-compatible /v1/decisions, which serves every decision model.",
	method: "post",
	path: "/",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {
		body: {
			content: {
				"application/json": {
					schema: systemOneRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			headers: rateLimitHeaders,
			content: {
				"application/json": {
					schema: systemOneResponseSchema,
				},
			},
			description: "Typed answers for the submitted questions.",
		},
		...standardErrorResponses(),
	},
});

systemone.openapi(createSystemOne, async (c): Promise<any> => {
	const startedAt = Date.now();
	const requestId = c.req.header("x-request-id")?.trim() || shortid(40);
	c.header("x-request-id", requestId);

	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch {
		return c.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
					param: null,
					code: "invalid_json",
				},
			},
			400,
		);
	}

	const validationResult = systemOneRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		return c.json(
			{
				error: {
					message: `Invalid request parameters: ${validationResult.error.issues[0]?.message ?? "unknown"}`,
					type: "invalid_request_error",
					param: validationResult.error.issues[0]?.path.join(".") ?? null,
					code: "invalid_parameters",
				},
			},
			400,
		);
	}

	const { model: requestedModel, state, questions } = validationResult.data;

	return await handleDecisionRequest(c, {
		apiOrigin: "systemone",
		path: "/v1/systemone",
		startedAt,
		requestId,
		rawBody,
		requestedModel,
		logSummary: `state: ${summarizeState(state)}\nquestions: ${summarizeQuestions(questions)}`,
		supportsProvider: (providerId, wireFormat) =>
			providerId === "typesafe" && wireFormat === "system-one",
		unsupportedModelHint: "Use /v1/decisions for this model.",
		buildUpstreamRequest: (_providerId, upstreamModel) => ({
			path: "/v1/systemone",
			body: { model: upstreamModel, state, questions },
		}),
		normalizeResponse: (_providerId, upstream, responseModel) => {
			const usage =
				upstream.usage && typeof upstream.usage === "object"
					? (upstream.usage as Record<string, unknown>)
					: {};
			return {
				body: { ...upstream, model: responseModel },
				inputTokens:
					typeof usage.input_tokens === "number" ? usage.input_tokens : null,
				outputTokens:
					typeof usage.output_tokens === "number" ? usage.output_tokens : null,
				logContent: upstream.answers ?? null,
			};
		},
	});
});
