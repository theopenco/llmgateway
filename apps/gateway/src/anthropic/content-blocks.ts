import { z } from "@hono/zod-openapi";

import { logger } from "@llmgateway/logger";

// Standard Anthropic "custom" tools: a name plus a JSON schema describing the
// parameters the model should produce.
export const anthropicCustomToolSchema = z.object({
	type: z.literal("custom").optional(),
	name: z.string(),
	description: z.string().optional(),
	input_schema: z.record(z.unknown()),
	cache_control: z
		.object({
			type: z.enum(["ephemeral"]),
			ttl: z.enum(["5m", "1h"]).optional(),
		})
		.nullish(),
	defer_loading: z.boolean().optional(),
	strict: z.boolean().optional(),
	allowed_callers: z.array(z.string()).optional(),
});

function blockType(entry: unknown): string | undefined {
	return entry && typeof entry === "object"
		? String((entry as { type?: unknown }).type)
		: undefined;
}

// Nested tool_result blocks are forwarded verbatim, so an `image` with a `url`
// source would have the provider fetch a caller-supplied URL that never went
// through the gateway's URL guard. Top-level `image` blocks only accept
// `base64` (see anthropicKnownContentBlockSchema), so hold tool_result images to the same
// rule.
const toolResultContentBlocksSchema = z
	.array(z.unknown())
	.superRefine((blocks, ctx) => {
		blocks.forEach((block, index) => {
			// Anthropic's tool_result content takes text and image blocks. The
			// native replay forwards the whole array verbatim, so a `document`
			// sibling would carry its `url` source to the provider without
			// passing the gateway URL guard; reject it here instead.
			if (blockType(block) === "document") {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [index, "type"],
					message:
						"tool_result content does not accept document blocks; send the document as user content",
				});
				return;
			}
			if (blockType(block) !== "image") {
				return;
			}
			const source = (
				block as {
					source?: { type?: unknown; media_type?: unknown; data?: unknown };
				}
			).source;
			// A base64 source without both fields replays as an empty image at
			// the provider, so hold nested blocks to the same requirement as the
			// top-level image schema above.
			if (
				source?.type !== "base64" ||
				typeof source.media_type !== "string" ||
				typeof source.data !== "string"
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [index, "source", "type"],
					message:
						"tool_result image blocks must use a base64 source with string media_type and data",
				});
			}
		});
	});

const anthropicKnownContentBlockSchema = z.union([
	z.object({
		type: z.literal("text"),
		text: z.string(),
		cache_control: z
			.object({
				type: z.enum(["ephemeral"]),
				ttl: z.enum(["5m", "1h"]).optional(),
			})
			.optional(),
	}),
	z.object({
		type: z.literal("image"),
		source: z.object({
			type: z.literal("base64"),
			media_type: z.string(),
			data: z.string(),
		}),
	}),
	z.object({
		type: z.literal("tool_use"),
		id: z.string(),
		name: z.string(),
		input: z.record(z.unknown()),
	}),
	z.object({
		type: z.literal("tool_result"),
		tool_use_id: z.string(),
		content: z.union([z.string(), toolResultContentBlocksSchema]).optional(),
		is_error: z.boolean().optional(),
		// Anthropic allows a breakpoint here, and in an agentic loop the
		// stable prefix usually ends on a tool result — dropping it would
		// cost the caller the cache hit they explicitly asked for.
		cache_control: z
			.object({
				type: z.enum(["ephemeral"]),
				ttl: z.enum(["5m", "1h"]).optional(),
			})
			.optional(),
	}),
	// Extended-thinking blocks echoed back in conversation history. Lowering
	// carries them on `reasoning_details` for replay to the provider that
	// signed them.
	z.object({
		type: z.literal("thinking"),
		thinking: z.string(),
		signature: z.string().optional(),
	}),
	z.object({
		type: z.literal("redacted_thinking"),
		data: z.string(),
	}),
	// Anthropic server tool blocks echoed back in conversation history. They
	// have no representation in the internal OpenAI-format request, so they
	// ride along verbatim and are replayed on Anthropic upstreams only: the
	// `encrypted_content` and `tool_reference` entries they carry are what the
	// model sees of the result. `.passthrough()` keeps every field Anthropic
	// sent.
	z
		.object({
			type: z.literal("server_tool_use"),
			id: z.string(),
			name: z.string(),
			input: z.record(z.unknown()).optional(),
		})
		.passthrough(),
	z
		.object({
			type: z.literal("web_search_tool_result"),
			tool_use_id: z.string(),
			// Either an array of web_search_result entries or an error object.
			content: z
				.union([z.array(z.unknown()), z.record(z.unknown())])
				.optional(),
		})
		.passthrough(),
	z
		.object({
			type: z.literal("web_fetch_tool_result"),
			tool_use_id: z.string(),
			content: z.record(z.unknown()).optional(),
		})
		.passthrough(),
	z
		.object({
			type: z.literal("tool_search_tool_result"),
			tool_use_id: z.string(),
			content: z.record(z.unknown()).optional(),
		})
		.passthrough(),
]);

// Claude Code's mid-conversation-tool-changes beta announces MCP tools that
// connect or drop after the first turn as blocks in a mid-conversation system
// message. A reference names a tool already declared in `tools`; a definition
// carries the tool inline.
export const anthropicToolChangeBlockSchema = z.object({
	type: z.enum(["tool_addition", "tool_removal"]),
	tool: z.union([
		z.object({ type: z.literal("tool_reference"), name: z.string() }),
		z.object({
			type: z.literal("tool_definition"),
			definition: anthropicCustomToolSchema,
		}),
	]),
	cache_control: z
		.object({
			type: z.enum(["ephemeral"]),
			ttl: z.enum(["5m", "1h"]).optional(),
		})
		.optional(),
});

const KNOWN_CONTENT_BLOCK_TYPES = new Set([
	"text",
	"image",
	"tool_use",
	"tool_result",
	"thinking",
	"redacted_thinking",
	"server_tool_use",
	"web_search_tool_result",
	"web_fetch_tool_result",
	"tool_search_tool_result",
	"tool_addition",
	"tool_removal",
]);

// Block types the gateway doesn't know yet (new client betas). Accepted and
// dropped during lowering so a client upgrade degrades instead of 400ing every
// request; a malformed known block still fails validation.
const anthropicUnknownContentBlockSchema = z
	.object({ type: z.string() })
	.refine((block) => !KNOWN_CONTENT_BLOCK_TYPES.has(block.type));

export const anthropicContentBlockInputSchema = z.union([
	anthropicKnownContentBlockSchema,
	anthropicToolChangeBlockSchema,
	anthropicUnknownContentBlockSchema,
]);

type AnthropicCustomTool = z.infer<typeof anthropicCustomToolSchema>;
type AnthropicKnownContentBlock = z.infer<
	typeof anthropicKnownContentBlockSchema
>;
type AnthropicContentBlockInput = z.infer<
	typeof anthropicContentBlockInputSchema
>;

function isToolChangeBlock(
	block: AnthropicContentBlockInput,
): block is z.infer<typeof anthropicToolChangeBlockSchema> {
	return block.type === "tool_addition" || block.type === "tool_removal";
}

function isKnownContentBlock(
	block: AnthropicContentBlockInput,
): block is AnthropicKnownContentBlock {
	return KNOWN_CONTENT_BLOCK_TYPES.has(block.type) && !isToolChangeBlock(block);
}

// Lowers the blocks that have no place in the internal request. Tool changes
// become a text note for the model, and their effect is applied to `tools`
// by the caller: a referenced tool is loaded eagerly, an inline definition is
// declared. Unknown block types are dropped.
export function lowerMidConversationBlocks<
	M extends { content: string | AnthropicContentBlockInput[] },
>(
	messages: M[],
): {
	messages: Array<
		Omit<M, "content"> & { content: string | AnthropicKnownContentBlock[] }
	>;
	surfacedToolNames: Set<string>;
	inlineToolDefinitions: Map<string, AnthropicCustomTool>;
} {
	const surfacedToolNames = new Set<string>();
	const inlineToolDefinitions = new Map<string, AnthropicCustomTool>();
	const droppedTypes = new Set<string>();

	const lowered = messages.map((message) => {
		if (typeof message.content === "string") {
			return { ...message, content: message.content };
		}
		const content: AnthropicKnownContentBlock[] = [];
		for (const block of message.content) {
			if (isToolChangeBlock(block)) {
				const name =
					block.tool.type === "tool_reference"
						? block.tool.name
						: block.tool.definition.name;
				const added = block.type === "tool_addition";
				if (!added) {
					surfacedToolNames.delete(name);
					inlineToolDefinitions.delete(name);
				} else if (block.tool.type === "tool_definition") {
					inlineToolDefinitions.set(name, block.tool.definition);
				} else {
					surfacedToolNames.add(name);
				}
				content.push({
					type: "text",
					text: `\nTool ${added ? "now" : "no longer"} available: ${name}`,
					...(block.cache_control && { cache_control: block.cache_control }),
				});
				continue;
			}
			if (isKnownContentBlock(block)) {
				content.push(block);
				continue;
			}
			droppedTypes.add(block.type);
		}
		return { ...message, content };
	});

	if (droppedTypes.size > 0) {
		logger.warn("Dropping unsupported Messages API content blocks", {
			types: [...droppedTypes],
		});
	}

	return { messages: lowered, surfacedToolNames, inlineToolDefinitions };
}
