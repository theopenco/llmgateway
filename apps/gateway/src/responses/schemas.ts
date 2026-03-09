import { z } from "@hono/zod-openapi";

const messageItemSchema = z.object({
	role: z.enum(["user", "assistant", "system", "developer"]),
	content: z
		.union([
			z.string(),
			z.array(
				z.union([
					z.object({
						type: z.literal("input_text"),
						text: z.string(),
					}),
					z.object({
						type: z.literal("output_text"),
						text: z.string(),
					}),
					z.object({
						type: z.literal("text"),
						text: z.string(),
					}),
					z.object({
						type: z.literal("input_image"),
						image_url: z.string().optional(),
						detail: z.enum(["low", "high", "auto"]).optional(),
					}),
					z.object({
						type: z.literal("image_url"),
						image_url: z.object({
							url: z.string(),
							detail: z.enum(["low", "high", "auto"]).optional(),
						}),
					}),
				]),
			),
		])
		.nullable()
		.optional(),
	name: z.string().optional(),
	tool_call_id: z.string().optional(),
	tool_calls: z
		.array(
			z.object({
				id: z.string(),
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
					arguments: z.string(),
				}),
			}),
		)
		.optional(),
});

const functionCallItemSchema = z.object({
	type: z.literal("function_call"),
	call_id: z.string(),
	name: z.string(),
	arguments: z.string(),
});

const functionCallOutputItemSchema = z.object({
	type: z.literal("function_call_output"),
	call_id: z.string(),
	output: z.string(),
});

const inputItemSchema = z.union([
	messageItemSchema,
	functionCallItemSchema,
	functionCallOutputItemSchema,
]);

export const responsesRequestSchema = z.object({
	model: z.string().openapi({
		example: "gpt-4o-mini",
	}),
	input: z.union([z.string(), z.array(inputItemSchema)]),
	instructions: z.string().optional(),
	previous_response_id: z.string().optional(),
	stream: z.boolean().optional().default(false),
	temperature: z
		.number()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	max_output_tokens: z
		.number()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	tools: z
		.array(
			z.union([
				z.object({
					type: z.literal("function"),
					name: z.string(),
					description: z.string().optional(),
					parameters: z.record(z.any()).optional(),
					strict: z.boolean().optional(),
				}),
				z.object({
					type: z.literal("web_search"),
					user_location: z
						.object({
							city: z.string().optional(),
							region: z.string().optional(),
							country: z.string().optional(),
							timezone: z.string().optional(),
						})
						.optional(),
					search_context_size: z.enum(["low", "medium", "high"]).optional(),
					max_uses: z.number().optional(),
				}),
			]),
		)
		.optional(),
	tool_choice: z
		.union([
			z.literal("auto"),
			z.literal("none"),
			z.literal("required"),
			z.object({
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
				}),
			}),
		])
		.optional(),
	reasoning: z
		.object({
			effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
			summary: z.enum(["detailed", "auto"]).optional(),
		})
		.optional(),
	text: z
		.object({
			format: z.union([
				z.object({ type: z.literal("text") }),
				z.object({ type: z.literal("json_object") }),
				z.object({
					type: z.literal("json_schema"),
					name: z.string(),
					schema: z.record(z.any()),
					strict: z.boolean().optional(),
				}),
			]),
		})
		.optional(),
	store: z.boolean().optional(),
	metadata: z.record(z.string()).optional(),
	top_p: z
		.number()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	truncation: z.enum(["auto", "disabled"]).optional().default("disabled"),
});

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;
