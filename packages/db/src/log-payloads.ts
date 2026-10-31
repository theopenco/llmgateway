import { z } from "zod";

export const moderationApiPayloadResultSchema = z
	.object({
		flagged: z.boolean().optional(),
		categories: z.record(z.string(), z.boolean()).optional(),
		category_scores: z.record(z.string(), z.number()).optional(),
		category_applied_input_types: z
			.record(z.string(), z.array(z.string()))
			.optional(),
	})
	.passthrough();

export const moderationApiPayloadSchema = z
	.object({
		id: z.string().optional(),
		model: z.string().optional(),
		results: z.array(moderationApiPayloadResultSchema).optional(),
	})
	.passthrough();

export const gatewayContentFilterResponseSchema = z.array(
	moderationApiPayloadSchema,
);

/** Moderation model family that produced a content-filter evaluation. */
export const contentFilterClassifierSchema = z.enum([
	"openai",
	"jev",
	"internal",
]);

/** Why a moderation call failed, coarse enough to aggregate on. */
export const contentFilterModerationErrorKindSchema = z.enum([
	// The classifier rejected the input (unsupported image format, corrupt
	// file, unreachable image URL). Expected, caused by the request.
	"upstream_4xx",
	"upstream_5xx",
	"timeout",
	"network",
	// A 2xx whose body was not a moderation response.
	"bad_response",
	"unexpected",
]);

export const contentFilterModerationErrorSchema = z.object({
	source: contentFilterClassifierSchema,
	kind: contentFilterModerationErrorKindSchema,
	inputType: z.enum(["text", "image"]).optional(),
	status: z.number().int().optional(),
	// Upstream error code (`invalid_image_format`) or network code (`ECONNRESET`).
	code: z.string().optional(),
	message: z.string(),
});

export const gatewayContentFilterEvaluationSchema = z.object({
	sampled: z.literal(true),
	provider: z.string(),
	tier: z.number().int(),
	overridden: z.boolean(),
	level: z.enum(["strict", "lenient"]),
	violation: z.boolean(),
	action: z.enum(["blocked", "logged", "passed"]),
	enforced: z.boolean(),
	exemptReason: z
		.enum(["global_log_only", "enterprise", "org_log_only"])
		.optional(),
	flagged: z.boolean(),
	matchedCategories: z.array(z.string()),
	// Highest score per category across every moderation result.
	categoryScores: z.record(z.string(), z.number()),
	moderationFailed: z.boolean(),
	// Absent on evaluations written before the classifier became selectable;
	// those all ran on OpenAI moderation.
	classifier: contentFilterClassifierSchema.optional(),
	// Wall-clock milliseconds of the classifier run; absent on older evaluations.
	durationMs: z.number().nonnegative().optional(),
	// The deciding text-only classifier's own share of durationMs, without the
	// image delegation. Absent when OpenAI decided and on older evaluations.
	classifierDurationMs: z.number().nonnegative().optional(),
	// Calls the internal classifier made: one per chunk of the text it read.
	classifierRequests: z.number().int().nonnegative().optional(),
	// Milliseconds of the image moderation delegated to OpenAI, failed calls
	// included. Absent when no image was delegated.
	imageDurationMs: z.number().nonnegative().optional(),
	// Input the internal classifier read; set only when it decided. Absent on
	// older evaluations, which all read the whole conversation.
	internalScope: z.enum(["full", "latest_turn"]).optional(),
	// Moderation calls that failed during the check, at most a handful; why
	// `moderationFailed` is set. Absent on older evaluations and on clean checks.
	moderationErrors: z.array(contentFilterModerationErrorSchema).optional(),
	// Legacy: verdict of the removed shadow classifier, present only on older
	// evaluations. It never changed `action`.
	shadow: z
		.object({
			classifier: contentFilterClassifierSchema,
			violation: z.boolean(),
			flagged: z.boolean(),
			matchedCategories: z.array(z.string()),
			categoryScores: z.record(z.string(), z.number()),
			moderationFailed: z.boolean(),
			durationMs: z.number().nonnegative().optional(),
			/** True when the shadow classifier disagreed with the deciding one. */
			disagreed: z.boolean(),
		})
		.optional(),
});

export type ContentFilterClassifier = z.infer<
	typeof contentFilterClassifierSchema
>;
export type ContentFilterModerationErrorKind = z.infer<
	typeof contentFilterModerationErrorKindSchema
>;
export type ContentFilterModerationError = z.infer<
	typeof contentFilterModerationErrorSchema
>;
export type ModerationApiPayload = z.infer<typeof moderationApiPayloadSchema>;
export type GatewayContentFilterResponse = z.infer<
	typeof gatewayContentFilterResponseSchema
>;
export type GatewayContentFilterEvaluation = z.infer<
	typeof gatewayContentFilterEvaluationSchema
>;
