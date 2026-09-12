import { z } from "@hono/zod-openapi";

/**
 * Flatten a Zod error into `path: message` pairs a client can act on.
 *
 * Union failures report a single issue at the union's own path ("Invalid
 * input"), burying the reason in `unionErrors`. That is useless on a schema
 * whose `input` is a union of unions: a request rejected for one bad item in a
 * 200-item array reports only "input: Invalid input". Each union is expanded to
 * the branch that got furthest into the value, which is the branch the client
 * meant.
 */
function expandIssues(issues: z.ZodIssue[]): z.ZodIssue[] {
	return issues.flatMap((issue) => {
		if (issue.code !== z.ZodIssueCode.invalid_union) {
			return [issue];
		}
		const nested = issue.unionErrors.flatMap((error) =>
			expandIssues(error.issues),
		);
		const deepest = Math.max(0, ...nested.map((i) => i.path.length));
		return nested.filter((i) => i.path.length === deepest);
	});
}

export function formatValidationError(error: z.ZodError): string {
	const seen = new Set<string>();
	for (const issue of expandIssues(error.issues)) {
		seen.add(`${issue.path.join(".")}: ${issue.message}`);
	}
	return [...seen].slice(0, 5).join(", ");
}

// OpenAI explicit prompt cache breakpoint marker (GPT-5.6 and later).
const promptCacheBreakpointSchema = z
	.object({
		mode: z.enum(["explicit"]).optional(),
	})
	.optional();

const responseInputContentSchema = z.union([
	z.object({
		type: z.literal("input_text"),
		text: z.string(),
		prompt_cache_breakpoint: promptCacheBreakpointSchema,
	}),
	z.object({
		type: z.literal("input_image"),
		image_url: z.string().optional(),
		file_id: z.string().optional(),
		detail: z.enum(["low", "high", "auto", "original"]).optional(),
		prompt_cache_breakpoint: promptCacheBreakpointSchema,
	}),
	z.object({
		type: z.literal("input_file"),
		file_data: z.string().optional(),
		file_id: z.string().optional(),
		file_url: z.string().optional(),
		filename: z.string().optional(),
		detail: z.enum(["low", "high"]).optional(),
		prompt_cache_breakpoint: promptCacheBreakpointSchema,
	}),
]);

const messageItemSchema = z.object({
	type: z.literal("message"),
	role: z.enum(["user", "assistant", "system", "developer"]),
	phase: z.enum(["commentary", "final_answer"]).optional(),
	content: z
		.union([
			z.string(),
			z.array(
				z.union([
					responseInputContentSchema,
					z.object({
						type: z.literal("output_text"),
						text: z.string(),
						prompt_cache_breakpoint: promptCacheBreakpointSchema,
					}),
					z.object({
						type: z.literal("text"),
						text: z.string(),
						prompt_cache_breakpoint: promptCacheBreakpointSchema,
					}),
					z.object({
						type: z.literal("image_url"),
						image_url: z.object({
							url: z.string(),
							detail: z.enum(["low", "high", "auto"]).optional(),
						}),
						prompt_cache_breakpoint: promptCacheBreakpointSchema,
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

// Clients replaying items statelessly (Codex sends the whole prior output back
// as `input`) serialize their absent optional fields as explicit nulls, so
// fields here must accept null as well as being omitted — rejecting them 400s a
// client on items the gateway itself just emitted. Nulls are normalized to
// undefined so downstream conversion stays unchanged.
const nullishToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
	schema
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val));

const itemStatusSchema = nullishToUndefined(
	z.enum(["in_progress", "completed", "incomplete"]),
);

const functionCallItemSchema = z.object({
	type: z.literal("function_call"),
	id: nullishToUndefined(z.string()),
	call_id: z.string(),
	name: z.string(),
	// Tool registries group tools under a namespace; the call names the tool
	// within it. The gateway flattens namespaces into unique chat-completions
	// tool names and restores this field on the way back out.
	namespace: nullishToUndefined(z.string()),
	arguments: z.string(),
	status: itemStatusSchema,
});

const functionCallOutputItemSchema = z.object({
	type: z.literal("function_call_output"),
	id: nullishToUndefined(z.string()),
	call_id: z.string(),
	output: z.union([z.string(), z.array(responseInputContentSchema)]),
	status: itemStatusSchema,
});

// Freeform ("custom") tool calls carry a raw text payload in `input` instead of
// JSON `arguments`, so the model can emit e.g. a patch or a script without
// JSON-escaping it.
const customToolCallItemSchema = z.object({
	type: z.literal("custom_tool_call"),
	id: nullishToUndefined(z.string()),
	call_id: z.string(),
	name: z.string(),
	namespace: nullishToUndefined(z.string()),
	input: z.string(),
	status: itemStatusSchema,
});

const customToolCallOutputItemSchema = z.object({
	type: z.literal("custom_tool_call_output"),
	id: nullishToUndefined(z.string()),
	call_id: z.string(),
	output: z.union([z.string(), z.array(responseInputContentSchema)]),
	status: itemStatusSchema,
});

// A tool declared inside an `additional_tools` item. Namespaces nest, so this
// is recursive; `custom` tools are freeform (no JSON schema).
export type ToolTreeNode =
	| {
			type: "namespace";
			name: string;
			description?: string;
			tools: ToolTreeNode[];
	  }
	| {
			type: "function";
			name: string;
			description?: string;
			parameters?: Record<string, unknown>;
			strict?: boolean;
	  }
	| { type: "custom"; name: string; description?: string };

const toolTreeNodeSchema: z.ZodType<ToolTreeNode, z.ZodTypeDef, unknown> =
	z.lazy(() =>
		z.discriminatedUnion("type", [
			z.object({
				type: z.literal("namespace"),
				name: z.string(),
				description: nullishToUndefined(z.string()),
				tools: z.array(toolTreeNodeSchema),
			}),
			z.object({
				type: z.literal("function"),
				name: z.string(),
				description: nullishToUndefined(z.string()),
				parameters: nullishToUndefined(z.record(z.any())),
				strict: nullishToUndefined(z.boolean()),
			}),
			z.object({
				type: z.literal("custom"),
				name: z.string(),
				description: nullishToUndefined(z.string()),
			}),
		]),
	);

// Codex 0.144+ declares its tools here instead of in the top-level `tools`
// array. The gateway flattens the tree into `tools` before conversion.
const additionalToolsItemSchema = z.object({
	type: z.literal("additional_tools"),
	id: nullishToUndefined(z.string()),
	role: nullishToUndefined(
		z.enum(["user", "assistant", "system", "developer"]),
	),
	tools: z.array(toolTreeNodeSchema),
});

// Item types that record client-side or provider-built-in activity the gateway
// cannot replay through provider routing (it never offers these tools). They
// are accepted so a client replaying its own transcript is not rejected, and
// dropped during conversion to chat messages.
export const UNREPLAYABLE_ITEM_TYPES = [
	"agent_message",
	"local_shell_call",
	"local_shell_call_output",
	"web_search_call",
	"tool_search_call",
	"tool_search_output",
	"compaction",
	"compaction_trigger",
	"context_compaction",
] as const;

const unreplayableItemSchema = z
	.object({ type: z.enum(UNREPLAYABLE_ITEM_TYPES) })
	.passthrough();

const imageGenerationCallItemSchema = z
	.object({
		type: z.literal("image_generation_call"),
		id: nullishToUndefined(z.string()),
		result: nullishToUndefined(z.string()),
		status: itemStatusSchema,
	})
	.passthrough();

const reasoningItemSchema = z.object({
	type: z.literal("reasoning"),
	id: nullishToUndefined(z.string()),
	summary: nullishToUndefined(z.array(z.record(z.any()))),
	content: nullishToUndefined(z.array(z.record(z.any()))),
	encrypted_content: nullishToUndefined(z.string()),
	status: itemStatusSchema,
});

// Reference to an item produced by a previous (stored) response. Stateful
// clients send these instead of re-sending the full item (e.g. a function_call
// the gateway emitted earlier). The id points at the `id` of a stored output
// item (e.g. `fc_...`, `msg_...`, `rs_...`) and is resolved back to the full
// item before conversion to chat messages.
const itemReferenceItemSchema = z.object({
	type: z.literal("item_reference"),
	id: z.string(),
});

// `type` is optional on message items in the Responses API, so default it
// before discriminating. A discriminated union is what makes a bad item report
// itself: a plain z.union collapses every branch failure into a single
// "input: Invalid input" that names neither the index nor the offending type.
const inputItemSchema = z.preprocess(
	(value) =>
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>).type === undefined
			? { ...(value as Record<string, unknown>), type: "message" }
			: value,
	z.discriminatedUnion("type", [
		messageItemSchema,
		reasoningItemSchema,
		functionCallItemSchema,
		functionCallOutputItemSchema,
		customToolCallItemSchema,
		customToolCallOutputItemSchema,
		imageGenerationCallItemSchema,
		additionalToolsItemSchema,
		itemReferenceItemSchema,
		unreplayableItemSchema,
	]),
);

export const responsesRequestSchema = z.object({
	model: z.string().openapi({
		example: "gpt-4o-mini",
	}),
	input: z.union([z.string(), z.array(inputItemSchema)]),
	instructions: z.string().optional(),
	previous_response_id: z.string().optional(),
	stream: z.boolean().optional().default(false),
	prompt_cache_key: z
		.string()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	prompt_cache_retention: z
		.enum(["in_memory", "24h"])
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	prompt_cache_options: z
		.object({
			mode: z.enum(["implicit", "explicit"]).optional(),
			ttl: z.enum(["30m"]).optional(),
		})
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	routing: z.enum(["auto", "price", "throughput", "latency"]).optional(),
	service_tier: z
		.enum(["auto", "default", "flex", "priority"])
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
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
					allowed_domains: z.array(z.string()).optional(),
					blocked_domains: z.array(z.string()).optional(),
				}),
				z.object({
					type: z.literal("image_generation"),
					size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
				}),
				// catch-all for unknown tool types (e.g. computer_use, code_interpreter)
				z.record(z.any()),
			]),
		)
		.optional(),
	tool_choice: z
		.union([
			z.literal("auto"),
			z.literal("none"),
			z.literal("required"),
			// Canonical Responses API shape: the function name is flat.
			z.object({
				type: z.literal("function"),
				name: z.string(),
			}),
			// Chat Completions shape, still accepted because clients that port a
			// chat-completions payload over to this endpoint keep sending it.
			z.object({
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
				}),
			}),
			// Demands a web search rather than offering one. See the Chat
			// Completions schema for what this unlocks.
			z.object({
				type: z.literal("web_search"),
			}),
		])
		.optional(),
	reasoning: z
		.object({
			effort: z
				.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
				.optional(),
			summary: z.enum(["detailed", "auto"]).optional(),
			context: z.enum(["auto", "current_turn", "all_turns"]).optional(),
		})
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	text: z.record(z.any()).optional(),
	store: z.boolean().optional(),
	// Additional output data to include. Only "reasoning.encrypted_content" has
	// gateway-level behavior (returns encrypted reasoning payloads on reasoning
	// output items so they can be replayed statelessly); other values are
	// accepted and ignored.
	include: z
		.array(z.string())
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	metadata: z.record(z.string()).optional(),
	top_p: z
		.number()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	truncation: z.enum(["auto", "disabled"]).optional().default("disabled"),
});

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

export const compactRequestSchema = z.object({
	model: z.string().openapi({
		example: "gpt-4o-mini",
	}),
	input: z
		.union([z.string(), z.array(inputItemSchema)])
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	previous_response_id: z
		.string()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	instructions: z
		.string()
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
	prompt_cache_key: z
		.string()
		.max(64)
		.nullable()
		.optional()
		.transform((val) => (val === null ? undefined : val)),
});

export type CompactRequest = z.infer<typeof compactRequestSchema>;
