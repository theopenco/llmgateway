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

export type ModerationApiPayload = z.infer<typeof moderationApiPayloadSchema>;
export type GatewayContentFilterResponse = z.infer<
	typeof gatewayContentFilterResponseSchema
>;
