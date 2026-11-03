import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { handleDecisionRequest } from "@/decisions/handle-decision-request.js";
import { loadDecisionImage } from "@/decisions/load-decision-image.js";
import {
	assetsBase64MB,
	extractInlineImages,
	loadTypeSafeAssets,
	typeSafeRequestHeaders,
} from "@/decisions/typesafe-translation.js";
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
	z.record(z.string(), z.unknown()),
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
		.record(z.string(), structuredTextSchema.nullable())
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

const boxQuestionSchema = z.object({
	type: z.literal("box"),
	instructions: instructionsSchema,
});

const questionSchema = z
	.discriminatedUnion("type", [
		noulQuestionSchema,
		choiceQuestionSchema,
		scoreQuestionSchema,
		boxQuestionSchema,
	])
	.openapi({
		description:
			"A typed question: `noul` (yes/no probability), `choice` (one option from a set), `score` (rating across ordered levels) or `box` (where a target is in an image; Jev 1.14 only).",
	});

const systemOneRequestSchema = z.object({
	model: z.string().openapi({
		description:
			"ID of the decision model to use. Optionally prefixed with a provider (`typesafe/…`).",
		example: "jev-1.14.0",
	}),
	state: structuredTextSchema.openapi({
		description:
			'The content to evaluate: plain text, or structured data such as a chat log or record. Images go in as `{ "type": "image_url", "image_url": { "url": "data:image/png;base64,…" } }` parts at any depth, or as `assets` references.',
		example: "Our production integration has been returning 500s for 3 days.",
	}),
	assets: z
		.record(
			z.string(),
			z.object({
				type: z.literal("image").optional(),
				format: z.enum(["png", "jpg", "jpeg"]),
				data_base64: z.string().min(1).openapi({
					description:
						"The image file, base64-encoded, without a `data:` prefix.",
				}),
			}),
		)
		.optional()
		.openapi({
			description:
				"Images keyed by a reference string. Write the reference in `state`, `instructions` or `criteria` and the model receives the image in its place. Experimental.",
		}),
	questions: z
		.record(z.string(), questionSchema)
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
		type: z.enum(["noul", "choice", "score", "box"]),
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
		legend: z.record(z.string(), z.unknown()).optional().openapi({
			description:
				"Level index to its description, on a score answer. A level given as an inline image part comes back as that part.",
		}),
		box: z
			.object({
				top: z.number(),
				bottom: z.number(),
				left: z.number(),
				right: z.number(),
			})
			.optional()
			.openapi({
				description:
					"Edges of the target as fractions of the image's height (`top`, `bottom`) and width (`left`, `right`), on a box answer.",
			}),
		probabilities: z.record(z.string(), z.number()).optional().openapi({
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
		answers: z.record(z.string(), systemOneAnswerSchema),
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

/**
 * A Score `legend` echoes each level as sent; a level that was an inline image
 * part comes back as that part instead of the gateway's reference.
 */
function restoreLegendImages(
	answers: unknown,
	partsByRef: Map<string, unknown>,
): unknown {
	if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
		return answers;
	}
	return Object.fromEntries(
		Object.entries(answers).map(([id, answer]) => {
			const legend = (answer as { legend?: unknown } | null)?.legend;
			if (!legend || typeof legend !== "object" || Array.isArray(legend)) {
				return [id, answer];
			}
			return [
				id,
				{
					...answer,
					legend: Object.fromEntries(
						Object.entries(legend).map(([level, value]) => [
							level,
							typeof value === "string" && partsByRef.has(value)
								? partsByRef.get(value)
								: value,
						]),
					),
				},
			];
		}),
	);
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

	const { model: requestedModel, assets } = validationResult.data;
	// TypeSafe reads images only from `assets`, so inline image parts become
	// references to assets loaded after the gateway's checks.
	const { state, questions, plan, partsByRef } = extractInlineImages(
		validationResult.data.state,
		validationResult.data.questions,
		Object.keys(assets ?? {}).length,
	);
	const hasAssets = assets !== undefined && Object.keys(assets).length > 0;
	const hasImageInput = hasAssets || plan.urls.length > 0;
	const hasBox = Object.values(questions).some(
		(question) => question.type === "box",
	);

	return await handleDecisionRequest(c, {
		apiOrigin: "systemone",
		path: "/v1/systemone",
		startedAt,
		requestId,
		rawBody,
		requestedModel,
		hasImageInput,
		logSummary: `state: ${summarizeState(state)}\nquestions: ${summarizeQuestions(questions)}`,
		supportsProvider: (providerId, wireFormat) =>
			providerId === "typesafe" && wireFormat === "system-one",
		unsupportedModelHint: "Use /v1/decisions for this model.",
		buildUpstreamRequest: (_providerId, upstreamModel) => {
			const body = { model: upstreamModel, state, questions };
			return {
				path: "/v1/systemone",
				body: hasAssets ? { ...body, assets } : body,
				headers: typeSafeRequestHeaders(body, {
					images: hasImageInput,
					box: hasBox,
				}),
				...(plan.urls.length > 0
					? {
							loadBody: async (signal) => ({
								assets: {
									...assets,
									...(await loadTypeSafeAssets(
										plan,
										(url, maxSizeMB) =>
											loadDecisionImage(url, maxSizeMB, signal),
										assetsBase64MB(assets),
									)),
								},
							}),
						}
					: {}),
			};
		},
		normalizeResponse: (_providerId, upstream, responseModel) => {
			const usage =
				upstream.usage && typeof upstream.usage === "object"
					? (upstream.usage as Record<string, unknown>)
					: {};
			return {
				body: {
					...upstream,
					model: responseModel,
					...(partsByRef.size > 0 && upstream.answers
						? { answers: restoreLegendImages(upstream.answers, partsByRef) }
						: {}),
				},
				inputTokens:
					typeof usage.input_tokens === "number" ? usage.input_tokens : null,
				outputTokens:
					typeof usage.output_tokens === "number" ? usage.output_tokens : null,
				logContent: upstream.answers ?? null,
			};
		},
	});
});
