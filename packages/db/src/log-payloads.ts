import { z } from "zod";

export const moderationApiPayloadResultSchema = z
	.object({
		flagged: z.boolean().optional(),
		categories: z.record(z.boolean()).optional(),
		category_scores: z.record(z.number()).optional(),
		category_applied_input_types: z.record(z.array(z.string())).optional(),
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
export const contentFilterClassifierSchema = z.enum(["openai", "jev"]);

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
	categoryScores: z.record(z.number()),
	moderationFailed: z.boolean(),
	// Absent on evaluations written before the classifier became selectable;
	// those all ran on OpenAI moderation.
	classifier: contentFilterClassifierSchema.optional(),
	// Second classifier run alongside the deciding one for comparison. Recorded
	// verbatim and never allowed to change `action`.
	shadow: z
		.object({
			classifier: contentFilterClassifierSchema,
			violation: z.boolean(),
			flagged: z.boolean(),
			matchedCategories: z.array(z.string()),
			categoryScores: z.record(z.number()),
			moderationFailed: z.boolean(),
			/** True when the shadow classifier disagreed with the deciding one. */
			disagreed: z.boolean(),
		})
		.optional(),
});

export type ContentFilterClassifier = z.infer<
	typeof contentFilterClassifierSchema
>;
export type ModerationApiPayload = z.infer<typeof moderationApiPayloadSchema>;
export type GatewayContentFilterResponse = z.infer<
	typeof gatewayContentFilterResponseSchema
>;
export type GatewayContentFilterEvaluation = z.infer<
	typeof gatewayContentFilterEvaluationSchema
>;
