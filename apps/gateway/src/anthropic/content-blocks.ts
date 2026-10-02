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
		content: z.union([z.string(), z.array(z.unknown())]).optional(),
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
	// Extended-thinking blocks echoed back in conversation history. They
	// carry no value for the internal OpenAI-format request, so they're
	// accepted here and stripped during transformation.
	z.object({
		type: z.literal("thinking"),
		thinking: z.string(),
		signature: z.string().optional(),
	}),
	z.object({
		type: z.literal("redacted_thinking"),
		data: z.string(),
	}),
	// Anthropic server-tool blocks (web search) echoed back in
	// conversation history. The gateway emits them on responses, so
	// native SDK clients replay them on the next turn; they carry no
	// representation in the internal OpenAI-format request (the
	// `encrypted_content` Anthropic requires is not reconstructible from
	// url_citation annotations), so they're accepted here and stripped
	// during transformation.
	z.object({
		type: z.literal("server_tool_use"),
		id: z.string(),
		name: z.string(),
		input: z.record(z.unknown()).optional(),
	}),
	z.object({
		type: z.literal("web_search_tool_result"),
		tool_use_id: z.string(),
		// Either an array of web_search_result entries or an error object.
		content: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
	}),
	// Server-side tool search results. Unlike the web-search blocks
	// above these ARE forwarded: Anthropic expands the tool_reference
	// entries they carry throughout the history, which is what lets
	// Claude reuse a discovered tool without searching again.
	z.object({
		type: z.literal("tool_search_tool_result"),
		tool_use_id: z.string(),
		content: z.record(z.unknown()).optional(),
	}),
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
