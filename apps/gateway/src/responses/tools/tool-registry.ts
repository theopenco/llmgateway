import type { ToolTreeNode } from "@/responses/schemas.js";
import type { GoogleExtraContent } from "@llmgateway/models";

/**
 * Codex 0.144+ (and any other client using the Responses tool registry) stops
 * sending a top-level `tools` array. Tools arrive as an `additional_tools`
 * input item holding a tree of namespaces, plain `function` tools and freeform
 * `custom` tools, and calls come back naming a tool plus the namespace it lives
 * in.
 *
 * Chat completions has neither namespaces nor freeform tools, so this module
 * defines the round trip:
 *
 * - namespaces are flattened into unique tool names (`<namespace>__<tool>`),
 * - `custom` tools are declared as a function taking a single `input` string,
 * - tool calls are mapped back to their original name/namespace, and calls to
 *   a `custom` tool are re-emitted as `custom_tool_call` items carrying the raw
 *   `input` payload.
 *
 * Without the reverse mapping a client would receive a call for a tool it never
 * registered under that name, or a JSON-wrapped payload for a tool it expects
 * raw text from.
 */

// The implicit namespace of an ungrouped tool. Its members keep bare names, so
// registries that only use this namespace round-trip unchanged.
const DEFAULT_NAMESPACE = "functions";

export interface ToolRegistry {
	/** Flat tool name -> namespace it was declared in. */
	namespaces: Map<string, string>;
	/** Flat names of tools declared as freeform `custom` tools. */
	customNames: Set<string>;
}

export function createToolRegistry(): ToolRegistry {
	return { namespaces: new Map(), customNames: new Set() };
}

/** Join a tool name and its namespace into a unique chat-completions name. */
export function flattenToolName(name: string, namespace?: string): string {
	return !namespace || namespace === DEFAULT_NAMESPACE
		? name
		: `${namespace}__${name}`;
}

/** Inverse of {@link flattenToolName}, resolved against what was declared. */
export function unflattenToolName(
	flatName: string,
	registry: ToolRegistry | undefined,
): { name: string; namespace?: string } {
	const namespace = registry?.namespaces.get(flatName);
	if (!namespace) {
		return { name: flatName };
	}
	return { name: flatName.slice(namespace.length + 2), namespace };
}

/**
 * Freeform tools have no JSON schema. Providers are only offered function
 * tools, so a `custom` tool is declared as one taking the raw payload as its
 * single string argument; {@link toResponsesToolCallItem} unwraps it again.
 */
function freeformParameters(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			input: {
				type: "string",
				description:
					"The raw text payload for this tool. Not JSON — pass the content verbatim.",
			},
		},
		required: ["input"],
		additionalProperties: false,
	};
}

function flattenNode(
	node: ToolTreeNode,
	namespace: string | undefined,
	tools: Record<string, unknown>[],
	registry: ToolRegistry,
): void {
	if (node.type === "namespace") {
		const nested =
			!namespace || namespace === DEFAULT_NAMESPACE
				? node.name
				: `${namespace}__${node.name}`;
		for (const child of node.tools) {
			flattenNode(child, nested, tools, registry);
		}
		return;
	}

	const flatName = flattenToolName(node.name, namespace);
	if (namespace && namespace !== DEFAULT_NAMESPACE) {
		registry.namespaces.set(flatName, namespace);
	}
	// A redeclaration replaces the earlier one, so the freeform flag must be
	// cleared rather than only ever set.
	registry.customNames.delete(flatName);

	if (node.type === "custom") {
		registry.customNames.add(flatName);
		tools.push({
			type: "function",
			name: flatName,
			...(node.description ? { description: node.description } : {}),
			parameters: freeformParameters(),
		});
		return;
	}

	tools.push({
		type: "function",
		name: flatName,
		...(node.description ? { description: node.description } : {}),
		...(node.parameters ? { parameters: node.parameters } : {}),
		...(node.strict !== undefined ? { strict: node.strict } : {}),
	});
}

/**
 * Pull every `additional_tools` item out of the input and turn the tool trees
 * it declares into top-level Responses API function tools.
 */
export function extractAdditionalTools(items: unknown[]): {
	items: unknown[];
	tools: Record<string, unknown>[];
	registry: ToolRegistry;
} {
	const registry = createToolRegistry();
	const tools: Record<string, unknown>[] = [];
	const remaining: unknown[] = [];

	for (const item of items) {
		const candidate = item as { type?: string; tools?: ToolTreeNode[] } | null;
		if (
			!candidate ||
			candidate.type !== "additional_tools" ||
			!Array.isArray(candidate.tools)
		) {
			remaining.push(item);
			continue;
		}
		for (const node of candidate.tools) {
			flattenNode(node, undefined, tools, registry);
		}
	}

	// A chained conversation replays the earlier turn's declarations alongside
	// this turn's; the newest declaration of a name wins.
	const deduped = new Map<string, Record<string, unknown>>();
	for (const tool of tools) {
		deduped.set(tool.name as string, tool);
	}

	return { items: remaining, tools: [...deduped.values()], registry };
}

/**
 * Unwrap the raw payload a freeform tool call was given. The model is asked for
 * `{"input": "..."}`; anything else (a partial stream, a model that emitted the
 * payload bare) is passed through verbatim rather than dropped.
 */
export function unwrapFreeformInput(args: string): string {
	try {
		const parsed: unknown = JSON.parse(args);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof (parsed as { input?: unknown }).input === "string"
		) {
			return (parsed as { input: string }).input;
		}
	} catch {
		// fall through
	}
	return args;
}

/**
 * Build the Responses API output item for a chat completions tool call,
 * restoring the namespace and the freeform shape the client declared.
 */
export function toResponsesToolCallItem(
	registry: ToolRegistry | undefined,
	toolCall: {
		id: string;
		callId: string;
		extraContent?: GoogleExtraContent;
		name: string;
		arguments: string;
		status: "in_progress" | "completed";
	},
): Record<string, unknown> {
	const { name, namespace } = unflattenToolName(toolCall.name, registry);
	const shared = {
		id: toolCall.id,
		call_id: toolCall.callId,
		...(toolCall.extraContent ? { extra_content: toolCall.extraContent } : {}),
		name,
		...(namespace ? { namespace } : {}),
		status: toolCall.status,
	};

	if (registry?.customNames.has(toolCall.name)) {
		return {
			type: "custom_tool_call",
			...shared,
			input:
				toolCall.status === "in_progress"
					? ""
					: unwrapFreeformInput(toolCall.arguments),
		};
	}

	return {
		type: "function_call",
		...shared,
		arguments: toolCall.status === "in_progress" ? "" : toolCall.arguments,
	};
}
