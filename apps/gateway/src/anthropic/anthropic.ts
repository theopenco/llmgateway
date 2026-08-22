import { randomUUID } from "node:crypto";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import { app } from "@/app.js";
import { internalApiOriginHeaders } from "@/lib/api-origin.js";
import { logGatewayClientError } from "@/lib/client-error-log.js";
import {
	buildAnthropicErrorBody,
	getAnthropicErrorType,
} from "@/lib/error-response.js";
import { extractAnthropicSessionId } from "@/lib/session-id.js";

import {
	isToolSearchBlock,
	TOOL_SEARCH_TOOL_TYPE_PREFIX,
} from "@llmgateway/actions";
import { logger, toError } from "@llmgateway/logger";

import {
	buildOpenAiRequestRejectionMessage,
	detectOpenAiChatCompletionsFields,
} from "./openai-request-detection.js";
import { buildAnthropicErrorEvent } from "./streaming-error-translation.js";
import { mapAnthropicThinkingToReasoning } from "./thinking-to-reasoning.js";

import type { ServerTypes } from "@/vars.js";
import type { AnthropicNativeBlock, CacheControl } from "@llmgateway/models";

// Most of the request schema is built from unions (content blocks, tool
// variants), and a union issue's own message is a useless "Invalid input" —
// the actionable detail sits in its branch errors. Expand those, then dedupe
// and cap so a body that mismatches every branch doesn't produce a wall of
// text.
const MAX_REPORTED_ISSUES = 12;

function flattenZodIssues(issues: z.ZodIssue[], depth = 0): string[] {
	const flattened: string[] = [];
	for (const issue of issues) {
		if (issue.code === "invalid_union" && depth < 3) {
			for (const unionError of issue.unionErrors) {
				flattened.push(...flattenZodIssues(unionError.issues, depth + 1));
			}
			continue;
		}
		flattened.push(`${issue.path.join(".")}: ${issue.message}`);
	}
	return flattened;
}

function formatValidationIssues(error: z.ZodError): string {
	const unique = [...new Set(flattenZodIssues(error.issues))];
	const reported = unique.slice(0, MAX_REPORTED_ISSUES);
	if (unique.length > reported.length) {
		reported.push(`… and ${unique.length - reported.length} more`);
	}
	return reported.join(", ");
}

// Request validation runs before the handler, so its failures never reached the
// handler's own error formatting and leaked a raw `{ success: false, error:
// ZodError }` body — a shape no Anthropic client can parse. Render every
// validation failure in Anthropic's error envelope instead, and upgrade the
// message when the body is recognisably an OpenAI Chat Completions request.
//
// This hook only runs once the schema has already rejected the request, so it
// changes what a failure says, never whether one happens.
export const anthropic = new OpenAPIHono<ServerTypes>({
	defaultHook: async (result, c) => {
		if (result.success) {
			return;
		}

		let rawBody: unknown = null;
		let invalidJson = false;
		try {
			rawBody = await c.req.json();
		} catch {
			invalidJson = true;
		}

		const openAiFields = detectOpenAiChatCompletionsFields(rawBody);
		const isOpenAiBody = openAiFields.length > 0;
		const message = invalidJson
			? "Invalid JSON in request body"
			: isOpenAiBody
				? buildOpenAiRequestRejectionMessage(openAiFields)
				: `Invalid request format: ${formatValidationIssues(result.error)}`;
		logger.warn("Invalid Messages API request", {
			issues: result.error.issues,
			path: c.req.path,
			method: c.req.method,
		});

		await logGatewayClientError(c, {
			apiOrigin: "messages",
			rawBody,
			message,
			cause: invalidJson
				? "invalid_json"
				: isOpenAiBody
					? "openai_request_format"
					: "invalid_request_format",
		});

		return c.json(buildAnthropicErrorBody({ message, status: 400 }), 400);
	},
});

const anthropicMessageSchema = z.object({
	role: z.enum(["system", "user", "assistant"]),
	content: z.union([
		z.string(),
		z.array(
			z.union([
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
					content: z
						.union([z.array(z.unknown()), z.record(z.unknown())])
						.optional(),
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
			]),
		),
	]),
	// OpenAI message properties
	tool_call_id: z.string().optional(),
	name: z.string().optional(),
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
	function_call: z
		.object({
			id: z.string().optional(),
			name: z.string(),
			arguments: z.union([z.string(), z.record(z.unknown())]),
		})
		.optional(),
});

// Standard Anthropic "custom" tools: a name plus a JSON schema describing the
// parameters the model should produce.
const anthropicCustomToolSchema = z.object({
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

// Anthropic's server-side tool search tool. Matched by prefix so the undated
// aliases and any future dated version keep working. `name` is optional
// because several Anthropic SDKs omit it.
const anthropicToolSearchToolSchema = z.object({
	type: z.string().regex(/^tool_search_tool/),
	name: z.string().optional(),
});

// Anthropic server-side tools (e.g. web_search_20250305, code_execution_*).
// These are executed by Anthropic, carry a versioned `type` instead of an
// `input_schema`, and must not be validated as custom tools.
const anthropicServerToolSchema = z.object({
	type: z.string(),
	name: z.string(),
	max_uses: z.number().optional(),
	allowed_domains: z.array(z.string()).optional(),
	blocked_domains: z.array(z.string()).optional(),
	user_location: z
		.object({
			type: z.literal("approximate").optional(),
			city: z.string().optional(),
			region: z.string().optional(),
			country: z.string().optional(),
			timezone: z.string().optional(),
		})
		.optional(),
	cache_control: z
		.object({
			type: z.enum(["ephemeral"]),
			ttl: z.enum(["5m", "1h"]).optional(),
		})
		.nullish(),
});

const anthropicToolSchema = z.union([
	anthropicCustomToolSchema,
	anthropicToolSearchToolSchema,
	anthropicServerToolSchema,
]);

const anthropicRequestSchema = z.object({
	model: z.string().openapi({
		description: "The model to use for completion",
		example: "claude-3-5-sonnet-20241022",
	}),
	messages: z.array(anthropicMessageSchema).openapi({
		description: "Array of message objects",
	}),
	max_tokens: z.number().min(1).openapi({
		description: "Maximum number of tokens to generate",
		example: 1024,
	}),
	system: z
		.union([
			z.string(),
			z.array(
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
			),
		])
		.optional()
		.openapi({
			description: "System prompt to provide context",
		}),
	temperature: z.number().min(0).max(1).optional().openapi({
		description: "Sampling temperature between 0 and 1",
		example: 0.7,
	}),
	tools: z.array(anthropicToolSchema).optional().openapi({
		description: "Available tools for the model to use",
	}),
	stream: z.boolean().optional().default(false).openapi({
		description: "Whether to stream the response",
		example: false,
	}),
	metadata: z
		.object({
			user_id: z.string().optional(),
		})
		.passthrough()
		.optional()
		.openapi({
			description:
				"Anthropic request metadata. Claude Code embeds the session id in user_id, which the gateway uses for sticky routing.",
		}),
	thinking: z
		.object({
			// Tolerant string (not an enum) so a future Anthropic thinking type
			// doesn't 400 the request; unknown types simply map to no reasoning.
			type: z.string(),
			budget_tokens: z.number().int().positive().optional(),
		})
		.optional()
		.openapi({
			description:
				"Anthropic extended-thinking configuration. Mapped onto the gateway's unified reasoning controls so the requested effort reaches the provider.",
		}),
	output_config: z
		.object({
			// Matches the chat completions reasoning-effort enum. Claude Code emits
			// the full range (including `xhigh` and `max`), so accept all of them;
			// tiers are never downgraded — downstream they map onto Anthropic's
			// native thinking controls (adaptive effort or a budget).
			effort: z
				.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
				.optional(),
		})
		.passthrough()
		.optional()
		.openapi({
			description:
				"Anthropic output configuration. `effort` controls adaptive reasoning depth on Opus 4.7+ models.",
		}),
});

const anthropicContentBlockSchema = z.object({
	type: z.enum([
		"text",
		"tool_use",
		"thinking",
		"server_tool_use",
		"web_search_tool_result",
		"tool_search_tool_result",
	]),
	text: z.string().optional(),
	thinking: z.string().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	input: z.record(z.unknown()).optional(),
	tool_use_id: z.string().optional(),
	// An array for web search results, an object for tool search results.
	content: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional(),
});

const anthropicResponseSchema = z.object({
	id: z.string(),
	type: z.literal("message"),
	role: z.literal("assistant"),
	model: z.string(),
	content: z.array(anthropicContentBlockSchema),
	stop_reason: z
		.enum([
			"end_turn",
			"max_tokens",
			"stop_sequence",
			"tool_use",
			"pause_turn",
			"refusal",
		])
		.nullable(),
	stop_sequence: z.string().nullable(),
	usage: z.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		// Anthropic emits these on caching-supported models, but we keep them
		// optional with a 0 default so the schema doesn't fail validation if an
		// older Claude model, a beta endpoint, or a future API change ever omits
		// them. The downstream conversion code already handles 0 correctly.
		cache_creation_input_tokens: z.number().optional().default(0),
		cache_read_input_tokens: z.number().optional().default(0),
		// Anthropic returns this breakdown when 5m/1h TTLs are mixed; emit it
		// whenever upstream gave us a per-TTL split so SDK clients can attribute
		// spend across the 1.25x and 2x cache write rates.
		cache_creation: z
			.object({
				ephemeral_5m_input_tokens: z.number(),
				ephemeral_1h_input_tokens: z.number(),
			})
			.optional(),
	}),
});

type AnthropicRequest = z.infer<typeof anthropicRequestSchema>;

interface AnthropicWebSearchResult {
	type: "web_search_result";
	url: string;
	title: string;
	encrypted_content: string;
	page_age: string | null;
}

// Response-only Anthropic content blocks. Clients replay the assistant turn
// verbatim on the next request, so these arrive back here; none of them has an
// OpenAI-format equivalent, so they're dropped from the lowered content. The
// tool search pair is carried separately on `anthropic_native_blocks` and
// spliced back in for Anthropic upstreams — see collectToolSearchBlocks.
const NON_FORWARDABLE_CONTENT_BLOCK_TYPES = new Set([
	"thinking",
	"redacted_thinking",
	"server_tool_use",
	"web_search_tool_result",
	"tool_search_tool_result",
]);

// The tool search pair out of an assistant turn. `server_tool_use` is matched
// on its name because the web-search variant shares the block type and must
// stay dropped: replaying it needs an `encrypted_content` the gateway cannot
// reconstruct from url_citation annotations.
function collectToolSearchBlocks(
	content: Array<{ type: string; name?: string }>,
): AnthropicNativeBlock[] {
	return content.filter(isToolSearchBlock) as AnthropicNativeBlock[];
}

function generateServerToolUseId(): string {
	return `srvtoolu_${randomUUID()}`;
}

// Anthropic message ids are `msg_`-prefixed and SDK clients key on that prefix.
// The inner /v1/chat/completions response carries an OpenAI-style
// `chatcmpl-` id, so normalize it here — reusing the inner id keeps the
// response correlatable with the gateway log instead of inventing a new one.
function toAnthropicMessageId(id: unknown): string {
	if (typeof id !== "string" || id.length === 0) {
		return `msg_${randomUUID()}`;
	}
	if (id.startsWith("msg_")) {
		return id;
	}
	return `msg_${id.replace(/^chatcmpl[-_]/, "")}`;
}

// Map the inner chat completions response's url_citation annotations onto
// Anthropic web_search_result entries. The OpenAI-format annotations only
// carry url/title, so the Anthropic-only fields (encrypted_content, page_age)
// are emitted as empty placeholders. Duplicate url/title pairs are collapsed;
// `seen` lets streaming callers dedupe across multiple annotation chunks.
function mapAnnotationsToWebSearchResults(
	annotations: unknown,
	seen?: Set<string>,
): AnthropicWebSearchResult[] {
	if (!Array.isArray(annotations)) {
		return [];
	}
	const seenKeys = seen ?? new Set<string>();
	const results: AnthropicWebSearchResult[] = [];
	for (const annotation of annotations) {
		if (
			!annotation ||
			typeof annotation !== "object" ||
			(annotation as { type?: string }).type !== "url_citation"
		) {
			continue;
		}
		const urlCitation = (
			annotation as {
				url_citation?: { url?: string; title?: string };
			}
		).url_citation;
		if (!urlCitation || typeof urlCitation.url !== "string") {
			continue;
		}
		const url = urlCitation.url;
		const title =
			typeof urlCitation.title === "string" && urlCitation.title
				? urlCitation.title
				: url;
		const key = `${url}\n${title}`;
		if (seenKeys.has(key)) {
			continue;
		}
		seenKeys.add(key);
		results.push({
			type: "web_search_result",
			url,
			title,
			encrypted_content: "",
			page_age: null,
		});
	}
	return results;
}

const messages = createRoute({
	operationId: "v1_messages",
	summary: "Anthropic Messages",
	description: "Create a message using Anthropic's API format",
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
					schema: anthropicRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: anthropicResponseSchema,
				},
				"text/event-stream": {
					schema: z.string(),
				},
			},
			description: "Successful response",
		},
	},
});

anthropic.openapi(messages, async (c) => {
	// Manual request parsing with better error handling
	let rawRequest: unknown;
	try {
		rawRequest = await c.req.json();
	} catch (error) {
		const message = `Invalid JSON in request body: ${error}`;
		logger.warn("Invalid Messages API JSON", {
			path: c.req.path,
			method: c.req.method,
		});
		await logGatewayClientError(c, {
			apiOrigin: "messages",
			rawBody: null,
			message,
			cause: "invalid_json",
		});
		throw new HTTPException(400, { message });
	}

	// Note: no OpenAI-format guard runs here. A body that reaches this point has
	// already satisfied the Anthropic schema, and rejecting it for carrying an
	// OpenAI-only parameter the schema stripped (`response_format`, `stop`,
	// `n`, …) would deny requests that succeed today. Unknown parameters stay
	// silently ignored; only structurally-OpenAI bodies are rejected, by the
	// schema itself, and the validation hook explains those.

	// Validate with our schema
	const validation = anthropicRequestSchema.safeParse(rawRequest);
	if (!validation.success) {
		const message = `Invalid request format: ${formatValidationIssues(validation.error)}`;
		logger.warn("Invalid Messages API request", {
			issues: validation.error.issues,
			path: c.req.path,
			method: c.req.method,
		});
		await logGatewayClientError(c, {
			apiOrigin: "messages",
			rawBody: rawRequest,
			message,
			cause: "invalid_request_format",
		});
		throw new HTTPException(400, { message });
	}

	const anthropicRequest: AnthropicRequest = validation.data;

	// Transform Anthropic request to OpenAI format
	const openaiMessages: Array<Record<string, unknown>> = [];

	// Add system message if provided.
	// When the caller supplies cache_control on any text block, preserve the
	// per-block array form so the inner /v1/chat/completions path can forward
	// cache_control markers verbatim to Anthropic. Otherwise, join with " " to
	// preserve the legacy behavior (and matching token counts) for callers
	// that pass array-form system without caching opt-in.
	if (anthropicRequest.system) {
		if (typeof anthropicRequest.system === "string") {
			openaiMessages.push({
				role: "system",
				content: anthropicRequest.system,
			});
		} else {
			const hasAnyCacheControl = anthropicRequest.system.some(
				(block) => block.cache_control,
			);
			if (hasAnyCacheControl) {
				openaiMessages.push({
					role: "system",
					content: anthropicRequest.system.map((block) => ({
						type: "text",
						text: block.text,
						...(block.cache_control && {
							cache_control: block.cache_control,
						}),
					})),
				});
			} else {
				openaiMessages.push({
					role: "system",
					content: anthropicRequest.system.map((block) => block.text).join(" "),
				});
			}
		}
	}

	// Transform messages using the approach from claude-code-proxy

	for (const message of anthropicRequest.messages) {
		// Handle assistant messages with tool_calls (OpenAI format)
		if (message.role === "assistant" && message.tool_calls) {
			openaiMessages.push({
				role: message.role,
				content: message.content || "",
				tool_calls: message.tool_calls,
			});
			continue;
		}

		// Handle assistant messages with function_call (legacy OpenAI format)
		if (message.role === "assistant" && message.function_call) {
			const toolCallId = message.function_call.id ?? `call_${randomUUID()}`;

			const toolCalls = [
				{
					id: toolCallId,
					type: "function" as const,
					function: {
						name: message.function_call.name,
						arguments:
							typeof message.function_call.arguments === "string"
								? message.function_call.arguments
								: JSON.stringify(message.function_call.arguments),
					},
				},
			];

			openaiMessages.push({
				role: message.role,
				content: message.content || "",
				tool_calls: toolCalls,
			});
			continue;
		}

		// Handle assistant messages with tool_use blocks (native Anthropic format)
		if (
			message.role === "assistant" &&
			Array.isArray(message.content) &&
			message.content.some((block) => block.type === "tool_use")
		) {
			const toolCalls = message.content
				.filter((block) => block.type === "tool_use")
				.map((block) => ({
					id: block.id,
					type: "function" as const,
					function: {
						name: block.name,
						arguments: JSON.stringify(block.input),
					},
				}));

			const textContent = message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("");

			const toolSearchBlocks = collectToolSearchBlocks(message.content);

			openaiMessages.push({
				role: message.role,
				content: textContent || "",
				tool_calls: toolCalls,
				...(toolSearchBlocks.length > 0 && {
					anthropic_native_blocks: toolSearchBlocks,
				}),
			});
			continue;
		}

		// Handle user messages with tool_result blocks (native Anthropic format)
		if (
			message.role === "user" &&
			Array.isArray(message.content) &&
			message.content.some((block) => block.type === "tool_result")
		) {
			// Group tool_result blocks by tool_use_id to avoid duplicates
			const toolResults = new Map<string, any[]>();
			for (const block of message.content) {
				if (block.type === "tool_result") {
					const toolUseId = block.tool_use_id;
					if (!toolResults.has(toolUseId)) {
						toolResults.set(toolUseId, []);
					}
					toolResults.get(toolUseId)!.push(block);
				}
			}

			// Convert each unique tool_use_id to a single tool message
			for (const [toolUseId, blocks] of toolResults) {
				// Combine content from all blocks with the same tool_use_id
				const combinedContent = blocks
					.map((block) =>
						typeof block.content === "string"
							? block.content
							: JSON.stringify(block.content),
					)
					.join("\n");

				// A client-side tool search answers with `tool_reference` blocks in
				// the tool_result content array. Stringifying them would leave
				// Anthropic nothing to expand, so keep the originals alongside the
				// lowered string and replay them on Anthropic upstreams.
				const referenceBlocks = blocks.flatMap((block) =>
					Array.isArray(block.content)
						? block.content.filter(
								(entry: unknown): entry is AnthropicNativeBlock =>
									!!entry &&
									typeof entry === "object" &&
									(entry as { type?: unknown }).type === "tool_reference",
							)
						: [],
				);

				// A breakpoint on the tool_result block has no home in the OpenAI
				// message shape, so carry it alongside. Blocks sharing a tool_use_id
				// collapse into one message, so the last marker wins — it is the one
				// that ends the prefix.
				const toolResultCacheControl = blocks.reduce<CacheControl | undefined>(
					(marker, block) => block.cache_control ?? marker,
					undefined,
				);

				openaiMessages.push({
					role: "tool",
					content: combinedContent,
					tool_call_id: toolUseId,
					...(referenceBlocks.length > 0 && {
						anthropic_native_blocks: referenceBlocks,
					}),
					...(toolResultCacheControl && {
						tool_result_cache_control: toolResultCacheControl,
					}),
				});
			}

			// Handle any remaining text content as a user message, preserving
			// cache_control markers the same way the generic text path below does.
			const textBlocks = message.content.filter(
				(block) => block.type === "text",
			);
			const hasAnyCacheControl = textBlocks.some(
				(block) => block.cache_control,
			);
			const textContent = textBlocks.map((block) => block.text).join("");

			if (hasAnyCacheControl) {
				openaiMessages.push({
					role: "user",
					content: textBlocks.map((block) => ({
						type: "text",
						text: block.text,
						...(block.cache_control && {
							cache_control: block.cache_control,
						}),
					})),
				});
			} else if (textContent) {
				openaiMessages.push({
					role: "user",
					content: textContent,
				});
			}
			continue;
		}

		// Handle regular messages and multi-modal content
		if (Array.isArray(message.content)) {
			// Blocks that exist only in the Anthropic response format (extended
			// thinking, server-side web search) are dropped: the internal
			// OpenAI-format request has no equivalent, and forwarding them verbatim
			// would reach the provider as an unknown content type.
			const forwardableBlocks = message.content.filter(
				(block) => !NON_FORWARDABLE_CONTENT_BLOCK_TYPES.has(block.type),
			);
			const toolSearchBlocks =
				message.role === "assistant"
					? collectToolSearchBlocks(message.content)
					: [];

			// A turn made up entirely of dropped blocks (e.g. a `pause_turn` reply
			// carrying only server_tool_use) would otherwise become an empty
			// message, which providers reject. A search-only turn is the exception:
			// its blocks still have to reach Anthropic, so it is forwarded with
			// empty content and dropped again for providers that can't take them.
			if (forwardableBlocks.length === 0) {
				if (toolSearchBlocks.length > 0) {
					openaiMessages.push({
						role: message.role,
						content: "",
						anthropic_native_blocks: toolSearchBlocks,
					});
				}
				continue;
			}

			// Check if this is complex multi-modal content that should be flattened
			const hasOnlyText = forwardableBlocks.every(
				(block) => block.type === "text",
			);
			const hasAnyCacheControl = forwardableBlocks.some(
				(block) => block.type === "text" && block.cache_control,
			);

			if (hasOnlyText && !hasAnyCacheControl) {
				// For text-only content with no cache markers, flatten to a simple
				// string to avoid content type issues.
				const textContent = forwardableBlocks
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("");

				openaiMessages.push({
					role: message.role,
					content: textContent,
					...(toolSearchBlocks.length > 0 && {
						anthropic_native_blocks: toolSearchBlocks,
					}),
				});
			} else {
				// For multi-modal content, or text content with cache_control markers,
				// transform blocks while preserving cache_control so the inner
				// completions path can forward it to Anthropic.
				const content = forwardableBlocks.map((block) => {
					if (block.type === "text" && block.text) {
						return {
							type: "text",
							text: block.text,
							...(block.cache_control && {
								cache_control: block.cache_control,
							}),
						};
					}
					if (block.type === "image" && block.source) {
						return {
							type: "image_url",
							image_url: {
								url: `data:${block.source.media_type};base64,${block.source.data}`,
							},
						};
					}
					return block;
				});

				openaiMessages.push({
					role: message.role,
					content,
					...(toolSearchBlocks.length > 0 && {
						anthropic_native_blocks: toolSearchBlocks,
					}),
				});
			}
		} else {
			// Simple string content
			openaiMessages.push({
				role: message.role,
				content: message.content,
			});
		}
	}

	// Transform tools if provided. Custom tools map to OpenAI function tools;
	// Anthropic server-side tools (e.g. web_search_20250305) carry a versioned
	// `type` and no `input_schema`, so they're translated to the internal
	// `web_search` tool the chat completions endpoint understands. Server tools
	// we can't represent are dropped (with a warning) rather than rejected.
	let openaiTools;
	if (anthropicRequest.tools) {
		openaiTools = anthropicRequest.tools
			.map((tool) => {
				if ("input_schema" in tool) {
					return {
						type: "function",
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.input_schema,
						},
						// Carried through to Anthropic upstreams and stripped
						// elsewhere, where the tool is simply loaded eagerly.
						...(tool.defer_loading === true && { defer_loading: true }),
						// Same deal for the caller's cache breakpoint: tools are the
						// base of Anthropic's cache hierarchy, so dropping it here cost
						// the caller the largest cacheable prefix they have.
						...(tool.cache_control && { cache_control: tool.cache_control }),
					};
				}

				if (tool.type.startsWith(TOOL_SEARCH_TOOL_TYPE_PREFIX)) {
					return {
						type: "tool_search",
						tool_search_type: tool.type,
						...(tool.name ? { name: tool.name } : {}),
					};
				}

				if (tool.type.startsWith("web_search")) {
					// The tool-search variant shares this branch's union but carries
					// none of the web-search options, so narrow before reading them.
					const searchTool = tool as z.infer<typeof anthropicServerToolSchema>;
					return {
						type: "web_search",
						...(searchTool.max_uses !== undefined
							? { max_uses: searchTool.max_uses }
							: {}),
						...(searchTool.user_location
							? { user_location: searchTool.user_location }
							: {}),
						...(searchTool.allowed_domains
							? { allowed_domains: searchTool.allowed_domains }
							: {}),
						...(searchTool.blocked_domains
							? { blocked_domains: searchTool.blocked_domains }
							: {}),
					};
				}

				logger.warn("Dropping unsupported Anthropic server tool", {
					type: tool.type,
					name: tool.name,
				});
				return null;
			})
			.filter((tool): tool is NonNullable<typeof tool> => tool !== null);
	}

	// Build OpenAI request
	const openaiRequest: Record<string, unknown> = {
		model: anthropicRequest.model,
		messages: openaiMessages,
		max_tokens: anthropicRequest.max_tokens,
		temperature: anthropicRequest.temperature,
		stream: anthropicRequest.stream,
	};

	if (openaiTools && openaiTools.length > 0) {
		openaiRequest.tools = openaiTools;
	}

	// Translate Anthropic reasoning controls (extended `thinking` and adaptive
	// `output_config.effort`) onto the unified reasoning fields the inner
	// /v1/chat/completions endpoint understands. Without this, native-Anthropic
	// clients like Claude Code lose reasoning entirely — the field is otherwise
	// dropped here and never reaches the provider.
	Object.assign(
		openaiRequest,
		mapAnthropicThinkingToReasoning(
			anthropicRequest.thinking,
			anthropicRequest.output_config?.effort,
		),
	);

	// Get user-agent for forwarding
	const userAgent = c.req.header("User-Agent") ?? "";

	// Sticky-routing session id: prefer an explicit header (x-session-id, or the
	// session-affinity/session-id headers coding agents such as pi attach),
	// otherwise derive it from Anthropic's metadata.user_id (Claude Code embeds
	// the session id here) and forward it to the chat completions endpoint, which
	// routes on it.
	const sessionId =
		c.req.header("x-session-id")?.trim() ||
		c.req.header("x-session-affinity")?.trim() ||
		c.req.header("session_id")?.trim() ||
		c.req.header("session-id")?.trim() ||
		extractAnthropicSessionId(anthropicRequest.metadata?.user_id);

	// Make internal request to the existing chat completions endpoint using app.request()
	const response = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: c.req.header("Authorization") ?? "",
			"x-api-key": c.req.header("x-api-key") ?? "",
			"User-Agent": userAgent,
			"x-request-id": c.req.header("x-request-id") ?? "",
			"x-source": c.req.header("x-source") ?? "",
			"x-debug": c.req.header("x-debug") ?? "",
			"HTTP-Referer": c.req.header("HTTP-Referer") ?? "",
			...internalApiOriginHeaders("messages"),
			...(sessionId ? { "x-session-id": sessionId } : {}),
			// Forward the fallback opt-out (presence-sensitive: the inner handler
			// checks headers.has()) so a hard provider pin (provider/model prefix
			// + x-no-fallback) works on the native Anthropic lane the same way it
			// does on /v1/chat/completions.
			...(c.req.header("x-no-fallback") !== undefined
				? { "x-no-fallback": c.req.header("x-no-fallback")! }
				: {}),
			// Forward the gateway response-cache opt-out so a native Anthropic
			// caller can request a fresh sample for a byte-identical body.
			...(c.req.header("x-no-cache") !== undefined
				? { "x-no-cache": c.req.header("x-no-cache")! }
				: {}),
			// Signal to the inner /v1/chat/completions handler that the caller used
			// Anthropic's explicit-budget thinking API (`thinking.type: "enabled"`).
			// On adaptive-only models the budget maps to an unsupported
			// reasoning.max_tokens; the inner handler uses this to mirror Anthropic's
			// own "use adaptive thinking" 400 (and log it as a client_error) instead
			// of surfacing the confusing OpenAI-flavored capability error.
			...(anthropicRequest.thinking?.type === "enabled"
				? { "x-llmgateway-thinking-type": "enabled" }
				: {}),
		},
		body: JSON.stringify(openaiRequest),
	});

	if (!response.ok) {
		logger.warn("Anthropic -> OpenAI request failed", {
			status: response.status,
			statusText: response.statusText,
		});
		const errorData = await response.text();

		// The upstream here is our own /v1/chat/completions, which returns an
		// OpenAI envelope `{ error: { message, type, ... } }`. Surface that inner
		// message directly (both streaming and non-streaming) instead of dumping
		// the raw JSON, so native Anthropic clients get a clean error string.
		let parsedError: unknown = null;
		try {
			parsedError = JSON.parse(errorData);
		} catch {
			parsedError = null;
		}
		const innerMessage =
			parsedError &&
			typeof parsedError === "object" &&
			"error" in parsedError &&
			parsedError.error &&
			typeof parsedError.error === "object" &&
			"message" in parsedError.error &&
			typeof parsedError.error.message === "string"
				? parsedError.error.message
				: errorData || response.statusText;

		if (anthropicRequest.stream) {
			// Derive the Anthropic error type from the HTTP status so streamed
			// errors match the non-streaming path.
			const errorEvent = buildAnthropicErrorEvent({
				type: "error",
				error: {
					type: getAnthropicErrorType(response.status),
					message: innerMessage,
				},
			});
			return streamSSE(c, async (stream) => {
				await stream.writeSSE({
					data: JSON.stringify(errorEvent),
					event: "error",
				});
				await stream.writeSSE({
					data: JSON.stringify({ type: "message_stop" }),
					event: "message_stop",
				});
			});
		}

		return c.json(
			buildAnthropicErrorBody({
				message: innerMessage,
				status: response.status,
			}),
			response.status as 400 | 401 | 402 | 403 | 404 | 429 | 500,
		);
	}

	// Surface gateway response-cache replays to native Anthropic clients. The
	// Anthropic response body has no metadata envelope to carry the marker the
	// inner /v1/chat/completions puts on `metadata.cached`, so forward the
	// header instead — without it a replayed body (same id, same usage) is
	// indistinguishable from a fresh sample.
	const innerCacheStatus = response.headers.get("x-llmgateway-cache");
	if (innerCacheStatus) {
		c.header("x-llmgateway-cache", innerCacheStatus);
	}

	// Handle streaming response
	if (anthropicRequest.stream) {
		return streamSSE(
			c,
			async (stream) => {
				if (!response.body) {
					throw new HTTPException(500, { message: "No response body" });
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();

				// SSE keepalive to prevent proxy/load balancer and client idle
				// timeouts from closing the connection during quiet gaps (slow
				// time-to-first-token, long reasoning before output, slow tool-arg
				// generation). Without this, coding clients see "The socket
				// connection was closed unexpectedly". The inner
				// /v1/chat/completions keepalive is consumed by this translator and
				// never reaches the client, so we emit our own here. A `: ping`
				// comment is part of the SSE spec and ignored by the Anthropic SDK.
				const KEEPALIVE_INTERVAL_MS = 15000;
				const keepaliveInterval = setInterval(() => {
					stream.write(": ping\n").catch(() => {
						// Stream likely closed; cleanup happens in finally.
					});
				}, KEEPALIVE_INTERVAL_MS);

				let buffer = "";
				let messageId = "";
				let model = "";
				const contentBlocks: Array<{
					type: string;
					text?: string;
					id?: string;
					name?: string;
					input?: string;
					// Web-search blocks are emitted complete (start + stop in one
					// go), so the end-of-stream stop flush must skip them.
					stopped?: boolean;
				}> = [];
				// Dedupe web-search citations across annotation chunks.
				const seenCitationKeys = new Set<string>();
				let usage: {
					input_tokens: number;
					output_tokens: number;
					cache_creation_input_tokens: number;
					cache_read_input_tokens: number;
					cache_creation?: {
						ephemeral_5m_input_tokens: number;
						ephemeral_1h_input_tokens: number;
					};
				} = {
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				};
				let currentTextBlockIndex: number | null = null;
				let currentThinkingBlockIndex: number | null = null;
				const toolCallBlockIndex = new Map<number, number>();
				let currentEventType: string | null = null;
				let stopReason: string | null = null;
				let contentBlockStopsSent = false;
				let messageDeltaSent = false;

				const extractUsage = (chunk: any) => {
					if (!chunk?.usage) {
						return;
					}
					const promptDetails = chunk.usage.prompt_tokens_details ?? {};
					const cacheRead: number = promptDetails.cached_tokens ?? 0;
					const cacheCreation: number =
						promptDetails.cache_write_tokens ??
						promptDetails.cache_creation_tokens ??
						0;
					const totalPrompt: number = chunk.usage.prompt_tokens ?? 0;
					const nonCachedInput = Math.max(
						0,
						totalPrompt - cacheRead - cacheCreation,
					);
					const breakdown = promptDetails.cache_creation as
						| {
								ephemeral_5m_input_tokens?: number;
								ephemeral_1h_input_tokens?: number;
						  }
						| undefined;
					usage = {
						input_tokens: nonCachedInput,
						output_tokens: chunk.usage.completion_tokens ?? 0,
						// Match Anthropic's API and always emit both fields
						// (set to 0 when inapplicable).
						cache_creation_input_tokens: cacheCreation,
						cache_read_input_tokens: cacheRead,
						...(breakdown &&
							cacheCreation > 0 && {
								cache_creation: {
									ephemeral_5m_input_tokens:
										breakdown.ephemeral_5m_input_tokens ?? 0,
									ephemeral_1h_input_tokens:
										breakdown.ephemeral_1h_input_tokens ?? 0,
								},
							}),
					};
				};

				const sendContentBlockStops = async () => {
					if (contentBlockStopsSent) {
						return;
					}
					contentBlockStopsSent = true;
					for (let i = 0; i < contentBlocks.length; i++) {
						if (contentBlocks[i].stopped) {
							continue;
						}
						await stream.writeSSE({
							data: JSON.stringify({
								type: "content_block_stop",
								index: i,
							}),
							event: "content_block_stop",
						});
					}
				};

				const sendMessageDelta = async () => {
					if (messageDeltaSent || stopReason === null) {
						return;
					}
					messageDeltaSent = true;
					await stream.writeSSE({
						data: JSON.stringify({
							type: "message_delta",
							delta: {
								stop_reason: stopReason,
								stop_sequence: null,
							},
							usage: usage,
						}),
						event: "message_delta",
					});
				};

				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";

						for (const rawLine of lines) {
							const line = rawLine.endsWith("\r")
								? rawLine.slice(0, -1)
								: rawLine;

							if (line === "") {
								currentEventType = null;
								continue;
							}

							if (line.startsWith("event: ")) {
								currentEventType = line.slice(7).trim();
								continue;
							}

							if (line.startsWith("data: ")) {
								const data = line.slice(6).trim();
								if (data === "[DONE]") {
									await sendContentBlockStops();
									await sendMessageDelta();
									// Send final Anthropic streaming event
									await stream.writeSSE({
										data: JSON.stringify({
											type: "message_stop",
										}),
										event: "message_stop",
									});
									return;
								}

								// Skip empty data lines
								if (!data) {
									continue;
								}

								let chunk: any;
								try {
									chunk = JSON.parse(data);
								} catch {
									// Ignore parsing errors for individual chunks
									continue;
								}

								const looksLikeError =
									currentEventType === "error" ||
									(chunk &&
										typeof chunk === "object" &&
										(chunk.type === "error" ||
											(chunk.error &&
												typeof chunk.error === "object" &&
												!chunk.choices &&
												!chunk.id)));

								if (looksLikeError) {
									await stream.writeSSE({
										data: JSON.stringify(buildAnthropicErrorEvent(chunk)),
										event: "error",
									});
									await stream.writeSSE({
										data: JSON.stringify({ type: "message_stop" }),
										event: "message_stop",
									});
									return;
								}

								if (!messageId && chunk.id) {
									messageId = toAnthropicMessageId(chunk.id);
									model = chunk.model ?? anthropicRequest.model;

									// Send message_start event
									await stream.writeSSE({
										data: JSON.stringify({
											type: "message_start",
											message: {
												id: messageId,
												type: "message",
												role: "assistant",
												model: model,
												content: [],
												stop_reason: null,
												stop_sequence: null,
												usage: {
													input_tokens: 0,
													output_tokens: 0,
													cache_creation_input_tokens: 0,
													cache_read_input_tokens: 0,
												},
											},
										}),
										event: "message_start",
									});
								}

								// Extract usage from any chunk that carries it. The
								// upstream chat completions endpoint emits usage in a
								// separate final chunk (no finish_reason), so we must not
								// gate this on choices/delta/finish_reason.
								extractUsage(chunk);

								const choice = chunk.choices?.[0];
								if (!choice) {
									continue;
								}

								const delta = choice.delta;
								if (!delta) {
									continue;
								}

								// Handle reasoning delta. The upstream chat completions
								// stream normalizes provider reasoning fields to
								// `delta.reasoning`; surface it as an Anthropic
								// `thinking` block (which precedes text/tool output).
								const reasoningDelta =
									delta.reasoning ?? delta.reasoning_content;
								if (
									typeof reasoningDelta === "string" &&
									reasoningDelta.length > 0
								) {
									if (currentThinkingBlockIndex === null) {
										currentThinkingBlockIndex = contentBlocks.length;
										contentBlocks.push({ type: "thinking", text: "" });
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_start",
												index: currentThinkingBlockIndex,
												content_block: { type: "thinking", thinking: "" },
											}),
											event: "content_block_start",
										});
									}

									const thinkingBlock =
										contentBlocks[currentThinkingBlockIndex];
									if (thinkingBlock && thinkingBlock.text !== undefined) {
										thinkingBlock.text += reasoningDelta;
									}

									await stream.writeSSE({
										data: JSON.stringify({
											type: "content_block_delta",
											index: currentThinkingBlockIndex,
											delta: {
												type: "thinking_delta",
												thinking: reasoningDelta,
											},
										}),
										event: "content_block_delta",
									});
								}

								// Handle web-search citation annotations. The upstream chat
								// completions stream surfaces provider web search results as
								// `delta.annotations` (url_citation entries); reconstruct the
								// Anthropic server_tool_use + web_search_tool_result block
								// pair so native SDK clients receive sources. Both blocks are
								// emitted complete, mirroring how Anthropic streams
								// web_search_tool_result content in the start event.
								if (
									Array.isArray(delta.annotations) &&
									delta.annotations.length > 0
								) {
									const webSearchResults = mapAnnotationsToWebSearchResults(
										delta.annotations,
										seenCitationKeys,
									);
									if (webSearchResults.length > 0) {
										// Anthropic streams blocks strictly sequentially: a text
										// block open before the search (preamble) is closed first,
										// and the text citing the results opens as a NEW block
										// after them. Close any open text block so later text
										// deltas don't interleave with an index that precedes the
										// search blocks.
										if (currentTextBlockIndex !== null) {
											contentBlocks[currentTextBlockIndex].stopped = true;
											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_stop",
													index: currentTextBlockIndex,
												}),
												event: "content_block_stop",
											});
											currentTextBlockIndex = null;
										}

										const serverToolUseId = generateServerToolUseId();
										const serverToolUseIndex = contentBlocks.length;
										contentBlocks.push({
											type: "server_tool_use",
											id: serverToolUseId,
											name: "web_search",
											stopped: true,
										});
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_start",
												index: serverToolUseIndex,
												content_block: {
													type: "server_tool_use",
													id: serverToolUseId,
													name: "web_search",
													input: {},
												},
											}),
											event: "content_block_start",
										});
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_stop",
												index: serverToolUseIndex,
											}),
											event: "content_block_stop",
										});

										const toolResultIndex = contentBlocks.length;
										contentBlocks.push({
											type: "web_search_tool_result",
											stopped: true,
										});
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_start",
												index: toolResultIndex,
												content_block: {
													type: "web_search_tool_result",
													tool_use_id: serverToolUseId,
													content: webSearchResults,
												},
											}),
											event: "content_block_start",
										});
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_stop",
												index: toolResultIndex,
											}),
											event: "content_block_stop",
										});
									}
								}

								// Handle Anthropic's server-side tool search blocks, which
								// the inner stream forwards verbatim. Emitted complete
								// (start + stop) like the web-search pair above, and for
								// the same reason: they carry no incremental deltas by the
								// time they reach here.
								if (
									Array.isArray(delta.anthropic_native_blocks) &&
									delta.anthropic_native_blocks.length > 0
								) {
									// Anthropic streams blocks strictly sequentially, so close
									// any open text block first — text that follows the search
									// opens a new block after it.
									if (currentTextBlockIndex !== null) {
										contentBlocks[currentTextBlockIndex].stopped = true;
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_stop",
												index: currentTextBlockIndex,
											}),
											event: "content_block_stop",
										});
										currentTextBlockIndex = null;
									}

									for (const block of delta.anthropic_native_blocks) {
										const blockIndex = contentBlocks.length;
										contentBlocks.push({
											type: block.type,
											stopped: true,
										});
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_start",
												index: blockIndex,
												content_block: block,
											}),
											event: "content_block_start",
										});
										await stream.writeSSE({
											data: JSON.stringify({
												type: "content_block_stop",
												index: blockIndex,
											}),
											event: "content_block_stop",
										});
									}
								}

								// Handle content delta
								if (delta.content) {
									// Find or create a text block
									if (currentTextBlockIndex === null) {
										// Look for existing text block (search from end). Skip
										// blocks already closed (e.g. a preamble text block
										// stopped when web-search blocks were emitted) — text
										// after the search results must open a new block.
										let lastTextBlockIndex = -1;
										for (let i = contentBlocks.length - 1; i >= 0; i--) {
											if (
												contentBlocks[i].type === "text" &&
												!contentBlocks[i].stopped
											) {
												lastTextBlockIndex = i;
												break;
											}
										}

										if (lastTextBlockIndex !== -1) {
											currentTextBlockIndex = lastTextBlockIndex;
										} else {
											// Create new text block
											currentTextBlockIndex = contentBlocks.length;
											contentBlocks.push({ type: "text", text: "" });
											// Send content_block_start event
											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_start",
													index: currentTextBlockIndex,
													content_block: { type: "text", text: "" },
												}),
												event: "content_block_start",
											});
										}
									}

									const textBlock = contentBlocks[currentTextBlockIndex];
									if (textBlock && textBlock.text !== undefined) {
										textBlock.text += delta.content;
									}

									// Send content_block_delta event
									await stream.writeSSE({
										data: JSON.stringify({
											type: "content_block_delta",
											index: currentTextBlockIndex,
											delta: { type: "text_delta", text: delta.content },
										}),
										event: "content_block_delta",
									});
								}

								// Handle tool calls
								if (delta.tool_calls) {
									for (const toolCall of delta.tool_calls) {
										if (toolCall.index === undefined) {
											continue;
										}

										let blockIndex = toolCallBlockIndex.get(toolCall.index);
										if (blockIndex === undefined) {
											blockIndex = contentBlocks.length;
											toolCallBlockIndex.set(toolCall.index, blockIndex);
											const id = toolCall.id ?? `tool_${toolCall.index}`;
											const name = toolCall.function?.name ?? "";
											contentBlocks.push({
												type: "tool_use",
												id,
												name,
												input: "",
											});

											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_start",
													index: blockIndex,
													content_block: {
														type: "tool_use",
														id,
														name,
														input: {},
													},
												}),
												event: "content_block_start",
											});
										}

										if (toolCall.function?.arguments) {
											const toolBlock = contentBlocks[blockIndex] as {
												type: "tool_use";
												id: string;
												name: string;
												input: string;
											};
											toolBlock.input += toolCall.function.arguments;

											await stream.writeSSE({
												data: JSON.stringify({
													type: "content_block_delta",
													index: blockIndex,
													delta: {
														type: "input_json_delta",
														partial_json: toolCall.function.arguments,
													},
												}),
												event: "content_block_delta",
											});
										}
									}
								}

								// Capture the stop reason and flush content_block_stops,
								// but defer message_delta until the final usage chunk
								// (or stream end) so usage is included.
								if (choice.finish_reason) {
									stopReason = determineStopReason(choice.finish_reason);
									await sendContentBlockStops();
								}
							}
						}
					}

					// Stream ended without an explicit [DONE]. Emit any deferred
					// terminator events so downstream clients see a well-formed
					// Anthropic stream.
					await sendContentBlockStops();
					await sendMessageDelta();
					if (stopReason !== null) {
						await stream.writeSSE({
							data: JSON.stringify({ type: "message_stop" }),
							event: "message_stop",
						});
					}
				} catch (error) {
					// The 200 response and SSE headers are already sent, so throwing
					// here cannot produce an HTTP error — it would abruptly tear down
					// the socket and the client would see "The socket connection was
					// closed unexpectedly". Instead, emit a well-formed Anthropic
					// terminal sequence (error event + message_stop) so the client
					// ends the stream cleanly. A client-side abort needs no write.
					if (error instanceof Error && error.name === "AbortError") {
						logger.info("Anthropic streaming request aborted by client", {
							message: error.message,
							path: c.req.path,
						});
					} else {
						logger.error(
							"Anthropic streaming error (mid-stream)",
							toError(error),
							{ path: c.req.path },
						);
						try {
							await stream.writeSSE({
								data: JSON.stringify(
									buildAnthropicErrorEvent({
										type: "error",
										error: {
											type: "api_error",
											message: `Streaming error: ${error instanceof Error ? error.message : String(error)}`,
										},
									}),
								),
								event: "error",
							});
							await stream.writeSSE({
								data: JSON.stringify({ type: "message_stop" }),
								event: "message_stop",
							});
						} catch (sseError) {
							logger.error(
								"Failed to send Anthropic streaming error event",
								toError(sseError),
							);
						}
					}
				} finally {
					clearInterval(keepaliveInterval);
					reader.releaseLock();
				}
			},
			async (error) => {
				if (error.name === "AbortError") {
					logger.info("Anthropic streaming request aborted by client", {
						message: error.message,
						path: c.req.path,
					});
				} else {
					logger.error("Anthropic streaming error (escaped handler)", error);
				}
			},
		);
	}

	// Handle non-streaming response
	let openaiText = "";
	let openaiResponse: any;
	try {
		openaiText = await response.text();
		openaiResponse = JSON.parse(openaiText);
	} catch (error) {
		logger.error("Failed to parse OpenAI response", {
			err: toError(error),
			responseText: openaiText || "(empty)",
		});
		throw new HTTPException(500, {
			message: `Failed to parse OpenAI response: ${error instanceof Error ? error.message : String(error)}`,
		});
	}

	// Transform OpenAI response to Anthropic format
	const content: any[] = [];

	// Surface reasoning as an Anthropic `thinking` block. Anthropic places
	// thinking before the assistant's text/tool output, so emit it first.
	const responseReasoning =
		openaiResponse.choices?.[0]?.message?.reasoning ??
		openaiResponse.choices?.[0]?.message?.reasoning_content;
	if (typeof responseReasoning === "string" && responseReasoning.length > 0) {
		content.push({
			type: "thinking",
			thinking: responseReasoning,
		});
	}

	// Reconstruct Anthropic server-side web search blocks from the inner
	// response's url_citation annotations. The request direction already maps
	// web_search_20250305 onto the internal web_search tool, but without this
	// the response direction dropped the citations entirely and native
	// Anthropic SDK clients saw no sources. Anthropic places server_tool_use +
	// web_search_tool_result before the text that cites them.
	const responseWebSearchResults = mapAnnotationsToWebSearchResults(
		openaiResponse.choices?.[0]?.message?.annotations,
	);
	if (responseWebSearchResults.length > 0) {
		const serverToolUseId = generateServerToolUseId();
		content.push({
			type: "server_tool_use",
			id: serverToolUseId,
			name: "web_search",
			input: {},
		});
		content.push({
			type: "web_search_tool_result",
			tool_use_id: serverToolUseId,
			content: responseWebSearchResults,
		});
	}

	// Anthropic's server-side tool search blocks come back verbatim from the
	// inner response. They precede the text and tool_use blocks they led to, and
	// the client has to replay them for Anthropic to keep expanding the
	// tool_reference entries they carry.
	const responseToolSearchBlocks =
		openaiResponse.choices?.[0]?.message?.anthropic_native_blocks;
	if (Array.isArray(responseToolSearchBlocks)) {
		content.push(...responseToolSearchBlocks);
	}

	if (openaiResponse.choices?.[0]?.message?.content) {
		content.push({
			type: "text",
			text: openaiResponse.choices[0].message.content,
		});
	}

	// Handle tool calls
	if (openaiResponse.choices?.[0]?.message?.tool_calls) {
		for (const toolCall of openaiResponse.choices[0].message.tool_calls) {
			let input: any;
			try {
				input = JSON.parse(toolCall.function.arguments ?? "{}");
			} catch (err) {
				logger.error("Failed to parse anthropic tool call arguments", {
					err: err instanceof Error ? err : new Error(String(err)),
					arguments: toolCall.function.arguments,
				});
				throw new HTTPException(500, {
					message: "Failed to parse tool call arguments",
				});
			}
			content.push({
				type: "tool_use",
				id: toolCall.id,
				name: toolCall.function.name,
				input,
			});
		}
	}

	const usageDetails = openaiResponse.usage?.prompt_tokens_details ?? {};
	const cachedTokens: number = usageDetails.cached_tokens ?? 0;
	const cacheCreationTokens: number =
		usageDetails.cache_write_tokens ?? usageDetails.cache_creation_tokens ?? 0;
	const totalPromptTokens: number = openaiResponse.usage?.prompt_tokens ?? 0;
	const nonCachedInputTokens = Math.max(
		0,
		totalPromptTokens - cachedTokens - cacheCreationTokens,
	);
	const cacheCreationBreakdown = usageDetails.cache_creation as
		| {
				ephemeral_5m_input_tokens?: number;
				ephemeral_1h_input_tokens?: number;
		  }
		| undefined;

	const anthropicResponse = {
		id: toAnthropicMessageId(openaiResponse.id),
		type: "message" as const,
		role: "assistant" as const,
		model: openaiResponse.model,
		content,
		stop_reason: determineStopReason(
			openaiResponse.choices?.[0]?.finish_reason,
		),
		stop_sequence: null,
		usage: {
			input_tokens: nonCachedInputTokens,
			output_tokens: openaiResponse.usage?.completion_tokens ?? 0,
			// Match Anthropic's actual API: always emit both fields (set to 0
			// when inapplicable) so SDK clients with strict typing can read them
			// without optionality checks.
			cache_creation_input_tokens: cacheCreationTokens,
			cache_read_input_tokens: cachedTokens,
			// Per Anthropic's spec, surface the per-TTL breakdown when upstream
			// supplied one so callers can attribute spend across the 5m (1.25x)
			// and 1h (2x) cache write rates.
			...(cacheCreationBreakdown &&
				cacheCreationTokens > 0 && {
					cache_creation: {
						ephemeral_5m_input_tokens:
							cacheCreationBreakdown.ephemeral_5m_input_tokens ?? 0,
						ephemeral_1h_input_tokens:
							cacheCreationBreakdown.ephemeral_1h_input_tokens ?? 0,
					},
				}),
		},
	};

	return c.json(anthropicResponse);
});

function determineStopReason(
	finishReason: string | undefined,
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "refusal" | null {
	switch (finishReason) {
		case "stop":
			return "end_turn";
		case "length":
			return "max_tokens";
		case "tool_calls":
			return "tool_use";
		case "content_filter":
			return "refusal";
		// Unknown finish reasons fall back to "end_turn" rather than null:
		// a null stopReason would suppress the terminal message_delta and
		// message_stop events in the streaming path, leaving clients with a
		// malformed stream.
		default:
			return "end_turn";
	}
}
