import { z } from "zod";

/**
 * `LanguageModelV*CallOptions` as it arrives on the wire.
 *
 * Deliberately lenient: the AI SDK ships new prompt/tool part types ahead of
 * provider support and the shapes drift between spec versions (v2 file parts
 * are a bare string/URL, v4 file parts are a tagged union). Anything this
 * schema does not model is either passed through or reported back as a warning
 * by the converters — a strict schema here would 400 on prompts that a real
 * provider answers fine.
 */
const filePartDataSchema = z.union([
	z.string(),
	z
		.object({
			type: z.string().optional(),
			data: z.unknown().optional(),
			url: z.string().optional(),
			text: z.string().optional(),
			reference: z.record(z.unknown()).optional(),
		})
		.passthrough(),
]);

const contentPartSchema = z
	.object({
		type: z.string(),
		text: z.string().optional(),
		filename: z.string().optional(),
		mediaType: z.string().optional(),
		data: filePartDataSchema.optional(),
		toolCallId: z.string().optional(),
		toolName: z.string().optional(),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
		providerExecuted: z.boolean().optional(),
		approvalId: z.string().optional(),
		approved: z.boolean().optional(),
		reason: z.string().optional(),
		providerOptions: z.record(z.unknown()).optional(),
	})
	.passthrough();

const messageSchema = z
	.object({
		role: z.enum(["system", "user", "assistant", "tool"]),
		content: z.union([z.string(), z.array(contentPartSchema)]),
		providerOptions: z.record(z.unknown()).optional(),
	})
	.passthrough();

const toolSchema = z
	.object({
		type: z.string(),
		name: z.string().optional(),
		id: z.string().optional(),
		description: z.string().optional(),
		inputSchema: z.record(z.unknown()).optional(),
		args: z.record(z.unknown()).optional(),
		providerOptions: z.record(z.unknown()).optional(),
	})
	.passthrough();

export const languageModelCallOptionsSchema = z
	.object({
		prompt: z.array(messageSchema),
		maxOutputTokens: z.number().optional(),
		temperature: z.number().optional(),
		stopSequences: z.array(z.string()).optional(),
		topP: z.number().optional(),
		topK: z.number().optional(),
		presencePenalty: z.number().optional(),
		frequencyPenalty: z.number().optional(),
		responseFormat: z
			.object({
				type: z.enum(["text", "json"]),
				schema: z.record(z.unknown()).optional(),
				name: z.string().optional(),
				description: z.string().optional(),
			})
			.optional(),
		seed: z.number().optional(),
		tools: z.array(toolSchema).optional(),
		toolChoice: z
			.object({
				type: z.enum(["auto", "none", "required", "tool"]),
				toolName: z.string().optional(),
			})
			.optional(),
		includeRawChunks: z.boolean().optional(),
		providerOptions: z.record(z.record(z.unknown())).optional(),
		headers: z.record(z.string().optional()).optional(),
	})
	.passthrough();

export type LanguageModelCallOptions = z.infer<
	typeof languageModelCallOptionsSchema
>;

export type SpecMessage = z.infer<typeof messageSchema>;
export type SpecContentPart = z.infer<typeof contentPartSchema>;
export type SpecTool = z.infer<typeof toolSchema>;
