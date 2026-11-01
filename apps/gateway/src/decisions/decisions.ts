import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
	rateLimitHeaders,
	standardErrorResponses,
} from "@/lib/error-schemas.js";

import {
	DECISIONS_UPSTREAM_PATH,
	getDecisionsUpstreamPath,
} from "@llmgateway/actions";
import { shortid } from "@llmgateway/db";

import { handleDecisionRequest } from "./handle-decision-request.js";
import { loadDecisionImage } from "./load-decision-image.js";
import {
	decisionInputHasImages,
	fromTypeSafeResponse,
	loadTypeSafeAssets,
	planTypeSafeImages,
	toTypeSafeRequest,
	typeSafeRequestHeaders,
} from "./typesafe-translation.js";

import type {
	DecisionInput,
	DecisionRequestBody,
} from "./typesafe-translation.js";
import type { ServerTypes } from "@/vars.js";
import type { ProviderId } from "@llmgateway/models";

const inputTextSchema = z.object({
	type: z.literal("input_text"),
	text: z.string(),
});

const inputImageSchema = z.object({
	type: z.literal("input_image"),
	image_url: z.string().openapi({
		description:
			"A base64-encoded image in a data URL or a publicly accessible HTTP(S) image URL.",
	}),
	detail: z.enum(["low", "high", "auto", "original"]).nullable().optional(),
});

const inputMessageSchema = z.object({
	type: z.literal("message").optional(),
	role: z.literal("user"),
	content: z.union([
		z.string(),
		z.array(z.discriminatedUnion("type", [inputTextSchema, inputImageSchema])),
	]),
});

const predicateQuestionSchema = z.object({
	type: z.literal("predicate"),
	name: z.string().optional(),
	instructions: z.string(),
});

const choiceQuestionSchema = z.object({
	type: z.literal("choice"),
	name: z.string().optional(),
	instructions: z.string(),
	choices: z
		.array(
			z.object({
				value: z.union([z.string(), z.boolean()]),
				description: z.string().optional(),
			}),
		)
		.min(2)
		.max(255)
		.openapi({
			description:
				"Between 2 and 255 unique options. Values are typed: a string and a boolean with the same text are distinct.",
		}),
});

const scoreQuestionSchema = z.object({
	type: z.literal("score"),
	name: z.string().optional(),
	instructions: z.string(),
	levels: z
		.array(
			z.object({
				label: z.string(),
				description: z.string().optional(),
			}),
		)
		.min(2)
		.openapi({ description: "Ordered levels, lowest first." }),
});

const questionSchema = z
	.discriminatedUnion("type", [
		predicateQuestionSchema,
		choiceQuestionSchema,
		scoreQuestionSchema,
	])
	.openapi({
		description:
			"A typed question: `predicate` (probability a condition is true), `choice` (one option from a set) or `score` (rating across ordered levels).",
	});

const decisionRequestSchema = z.object({
	model: z.string().openapi({
		description:
			"ID of the decision model to use, optionally prefixed with a provider (`openai/gpt-6-luna-decisions`, `azure/microsoft-decision-1`, `typesafe/jev-1.14.0`).",
		example: "gpt-6-luna-decisions",
	}),
	input: z.union([z.string(), z.array(inputMessageSchema)]).openapi({
		description:
			"The text or images to evaluate for every question: a string, or user messages with `input_text` and `input_image` parts. Image input depends on the model.",
		example: "I was charged twice for my order.",
	}),
	questions: z.array(questionSchema).min(1).openapi({
		description:
			"Questions to evaluate against the input. Answers come back in the same order, echoing each question's `name`.",
	}),
	safety_identifier: z.string().max(128).nullable().optional().openapi({
		description:
			"Accepted for OpenAI compatibility. Upstream abuse attribution always uses LLM Gateway's opaque per-API-key identifier.",
	}),
});

const probabilitySchema = z
	.object({
		value: z.union([z.string(), z.boolean(), z.number()]),
		label: z.string().optional(),
		probability: z.number(),
	})
	.passthrough();

const decisionAnswerSchema = z
	.object({
		type: z.enum(["predicate", "choice", "score", "refusal"]),
		name: z.string().nullable().optional(),
		probability: z.number().optional().openapi({
			description:
				"Probability from 0 to 1 that the condition is true, on a predicate answer.",
		}),
		choice: z.union([z.string(), z.boolean()]).optional().openapi({
			description: "Highest-probability option, on a choice answer.",
		}),
		score: z.number().optional().openapi({
			description:
				"Probability-weighted average of the level indices, on a score answer.",
		}),
		probabilities: z.array(probabilitySchema).optional(),
		confidence: z.number().optional(),
	})
	.passthrough();

const decisionResponseSchema = z
	.object({
		model: z.string(),
		answers: z.array(decisionAnswerSchema),
		usage: z
			.object({
				input_tokens: z.number().int(),
				output_tokens: z.number().int(),
				total_tokens: z.number().int(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough()
	.openapi({
		description: "One typed answer per question, in question order.",
	});

/** Request summary for the log; image data is replaced by a placeholder. */
function summarizeInput(input: DecisionInput): string {
	const text =
		typeof input === "string"
			? input
			: input
					.map((message) =>
						typeof message.content === "string"
							? message.content
							: message.content
									.map((part) =>
										part.type === "input_text" ? part.text : "[image]",
									)
									.join("\n"),
					)
					.join("\n\n");
	return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

/** A billable token count: a non-negative safe integer, else unknown. */
function tokenCount(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

function readUsage(upstream: Record<string, unknown>) {
	const usage =
		upstream.usage && typeof upstream.usage === "object"
			? (upstream.usage as Record<string, unknown>)
			: {};
	return {
		inputTokens: tokenCount(usage.input_tokens),
		outputTokens: tokenCount(usage.output_tokens),
	};
}

// Schema failures use the OpenAI error envelope, like every other error on
// this OpenAI-compatible endpoint, instead of zod-openapi's raw issue dump.
export const decisions = new OpenAPIHono<ServerTypes>({
	defaultHook: (result, c) => {
		if (result.success) {
			return;
		}
		const issue = result.error.issues[0];
		return c.json(
			{
				error: {
					message: `Invalid request parameters: ${issue?.message ?? "unknown"}`,
					type: "invalid_request_error",
					param: issue?.path.join(".") || null,
					code: "invalid_parameters",
				},
			},
			400,
		);
	},
});

const createDecision = createRoute({
	operationId: "v1_decisions",
	summary: "Decisions",
	description:
		"Evaluate text or images against typed questions and get calibrated predicate, choice and score answers back. OpenAI-compatible API.",
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
					schema: decisionRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			headers: rateLimitHeaders,
			content: {
				"application/json": {
					schema: decisionResponseSchema,
				},
			},
			description: "Typed answers for the submitted questions.",
		},
		...standardErrorResponses(),
	},
});

decisions.openapi(createDecision, async (c): Promise<any> => {
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

	const validationResult = decisionRequestSchema.safeParse(rawBody);
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

	const request: DecisionRequestBody = validationResult.data;

	return await handleDecisionRequest(c, {
		apiOrigin: "decisions",
		path: "/v1/decisions",
		startedAt,
		requestId,
		rawBody,
		requestedModel: request.model,
		hasImageInput: decisionInputHasImages(request.input),
		logSummary: `input: ${summarizeInput(request.input)}\nquestions: ${request.questions
			.map(
				(question, index) =>
					`${question.name ?? `#${index + 1}`} (${question.type})`,
			)
			.join(", ")}`,
		// System One providers get a translated request; OpenAI and Airside
		// carriers take the OpenAI-compatible body as-is.
		buildUpstreamRequest: (
			providerId,
			upstreamModel,
			safetyIdentifier,
			wireFormat,
		) => {
			if (wireFormat === "openai") {
				return {
					path: DECISIONS_UPSTREAM_PATH,
					body: {
						model: upstreamModel,
						input: request.input,
						questions: request.questions,
						// OpenAI attributes abuse to it, so the client's value is
						// replaced by the API key's; Airside carriers get none.
						...(providerId === "openai"
							? { safety_identifier: safetyIdentifier }
							: {}),
					},
				};
			}
			const images = planTypeSafeImages(request.input);
			const body = toTypeSafeRequest(upstreamModel, request, images.refs);
			return {
				path: getDecisionsUpstreamPath(providerId as ProviderId),
				body,
				// Azure's System One route takes neither images nor TypeSafe's
				// opt-ins.
				headers:
					providerId === "typesafe"
						? typeSafeRequestHeaders(body, {
								images: images.urls.length > 0,
							})
						: undefined,
				...(images.urls.length > 0
					? {
							// System One takes images as inline base64 assets, so
							// remote URLs are downloaded.
							loadBody: async (signal) => ({
								assets: await loadTypeSafeAssets(images, (url, maxSizeMB) =>
									loadDecisionImage(url, maxSizeMB, signal),
								),
							}),
						}
					: {}),
			};
		},
		normalizeResponse: (_providerId, upstream, responseModel, wireFormat) => {
			const body =
				wireFormat === "openai"
					? { ...upstream, model: responseModel }
					: fromTypeSafeResponse(upstream, request, responseModel);
			return {
				body,
				...readUsage(upstream),
				logContent: body.answers,
			};
		},
	});
});
