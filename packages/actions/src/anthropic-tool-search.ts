import type {
	AnthropicNativeBlock,
	BaseMessage,
	OpenAIToolInput,
	OpenAIToolSearchToolInput,
	OpenAIWebFetchToolInput,
	ProviderId,
} from "@llmgateway/models";

/**
 * Anthropic's server-side tool search tool types all share this prefix. Matched
 * by prefix rather than by an exact list so a future dated version (or the
 * undated `tool_search_tool_regex` / `tool_search_tool_bm25` aliases) keeps
 * working without a gateway release.
 */
export const TOOL_SEARCH_TOOL_TYPE_PREFIX = "tool_search_tool";

/**
 * Providers that speak the Anthropic Messages API natively and therefore
 * understand `defer_loading`, the tool search tool, and the `server_tool_use` /
 * `tool_search_tool_result` / `tool_reference` blocks. Everything else gets
 * these stripped: the tools are still sent, just eagerly, which costs prompt
 * cache and tokens but never fails.
 *
 * `vertex-anthropic` qualifies because it posts an Anthropic Messages body to
 * `:rawPredict`, and Anthropic lists tool search as available on Google Cloud.
 *
 * `azure-anthropic` qualifies because Microsoft Foundry fronts the Messages API
 * directly. Its published capability table omits server-side tool search, but a
 * live Foundry deployment accepts `defer_loading` and returns the same
 * `server_tool_use` / `tool_search_tool_regex` blocks as the direct API.
 *
 * AWS Bedrock is excluded for a transport reason, not a capability one:
 * Anthropic offers tool search there only through InvokeModel, and this gateway
 * drives Bedrock through the Converse API (see get-provider-endpoint). Moving
 * the Bedrock Anthropic path to InvokeModel is what would unlock it — do not
 * "fix" this by adding aws-bedrock here while Converse is still the transport.
 *
 * Model support is a separate axis and is deliberately not gated here: tool
 * search needs a Claude 4.5-generation model or newer, and an older model is
 * rejected upstream with a 4xx rather than being silently downgraded, the same
 * way unsupported reasoning efforts are handled.
 */
export function usesAnthropicMessagesApi(provider: ProviderId): boolean {
	return (
		provider === "anthropic" ||
		provider === "vertex-anthropic" ||
		provider === "azure-anthropic"
	);
}

export function isToolSearchTool(
	tool: OpenAIToolInput,
): tool is OpenAIToolSearchToolInput {
	return tool.type === "tool_search";
}

export function isToolSearchBlock(block: unknown): boolean {
	if (!block || typeof block !== "object") {
		return false;
	}
	const { type, name } = block as { type?: unknown; name?: unknown };
	if (type === "tool_search_tool_result") {
		return true;
	}
	return (
		type === "server_tool_use" &&
		typeof name === "string" &&
		name.startsWith(TOOL_SEARCH_TOOL_TYPE_PREFIX)
	);
}

/**
 * Server tool blocks: every `server_tool_use` call and its
 * `<tool>_tool_result`. They carry what the model needs to see the result on a
 * later turn (`encrypted_content`, `tool_reference`s), so they travel verbatim.
 */
export function isAnthropicServerToolBlock(block: unknown): boolean {
	if (!block || typeof block !== "object") {
		return false;
	}
	const { type } = block as { type?: unknown };
	return (
		type === "server_tool_use" ||
		(typeof type === "string" &&
			type.endsWith("_tool_result") &&
			type !== "tool_result")
	);
}

/** Server tools the gateway forwards to Anthropic. */
export function isForwardedServerToolName(name: unknown): boolean {
	return (
		typeof name === "string" &&
		(name === "web_search" ||
			name === "web_fetch" ||
			name.startsWith(TOOL_SEARCH_TOOL_TYPE_PREFIX))
	);
}

/**
 * The server tool blocks of a turn that can be replayed: calls to a tool the
 * gateway forwards, and the results paired with them by id. Anything else
 * (an MCP or code execution result, say) would reach Anthropic orphaned or
 * without its tool.
 */
export function pairedServerToolBlocks<T>(blocks: readonly T[]): T[] {
	const callIds = new Set<unknown>();
	for (const block of blocks) {
		const { type, id, name } = block as {
			type?: unknown;
			id?: unknown;
			name?: unknown;
		};
		if (type === "server_tool_use" && isForwardedServerToolName(name)) {
			callIds.add(id);
		}
	}
	return blocks.filter((block) => {
		if (!isAnthropicServerToolBlock(block)) {
			return false;
		}
		const {
			type,
			id,
			tool_use_id: toolUseId,
		} = block as {
			type?: unknown;
			id?: unknown;
			tool_use_id?: unknown;
		};
		return callIds.has(type === "server_tool_use" ? id : toolUseId);
	});
}

/**
 * Removes web fetch calls and their results, for an upstream without the tool
 * (Anthropic does not offer it on Google Cloud).
 */
export function withoutWebFetchBlocks<T>(blocks: readonly T[]): T[] {
	const fetchIds = new Set<unknown>();
	for (const block of blocks) {
		const { type, id, name } = block as {
			type?: unknown;
			id?: unknown;
			name?: unknown;
		};
		if (type === "server_tool_use" && name === "web_fetch") {
			fetchIds.add(id);
		}
	}
	return blocks.filter((block) => {
		const {
			type,
			id,
			tool_use_id: toolUseId,
		} = block as {
			type?: unknown;
			id?: unknown;
			tool_use_id?: unknown;
		};
		return !(
			type === "web_fetch_tool_result" ||
			(type === "server_tool_use" ? fetchIds.has(id) : fetchIds.has(toolUseId))
		);
	});
}

export function isWebFetchTool(
	tool: OpenAIToolInput,
): tool is OpenAIWebFetchToolInput {
	return tool.type === "web_fetch";
}

/**
 * Renders the web fetch tool in Anthropic's wire format.
 */
export function toAnthropicWebFetchTool(
	tool: OpenAIWebFetchToolInput,
): AnthropicNativeBlock {
	const { type: _type, web_fetch_type: webFetchType, name, ...options } = tool;
	return { type: webFetchType, name: name ?? "web_fetch", ...options };
}

/**
 * Renders the tool search tool in Anthropic's wire format.
 */
export function toAnthropicToolSearchTool(
	tool: OpenAIToolSearchToolInput,
): AnthropicNativeBlock {
	return {
		type: tool.tool_search_type,
		name: tool.name ?? tool.tool_search_type.replace(/_\d{8}$/, ""),
	};
}

/**
 * Removes the Anthropic-only tool extensions for upstreams that would reject
 * them (`defer_loading` and `cache_control` are unknown properties, and the
 * tool search tool has no counterpart at all).
 */
export function stripAnthropicToolExtensions(
	tools: OpenAIToolInput[] | undefined,
): OpenAIToolInput[] | undefined {
	if (!tools) {
		return tools;
	}
	return tools
		.filter((tool) => !isToolSearchTool(tool) && !isWebFetchTool(tool))
		.map((tool) => {
			if (
				tool.type !== "function" ||
				(tool.defer_loading === undefined &&
					tool.cache_control === undefined &&
					tool.allowed_callers === undefined &&
					tool.eager_input_streaming === undefined)
			) {
				return tool;
			}
			const {
				defer_loading: _deferLoading,
				cache_control: _cacheControl,
				allowed_callers: _allowedCallers,
				eager_input_streaming: _eagerInputStreaming,
				...rest
			} = tool;
			return rest;
		});
}

/**
 * Removes the Anthropic-only content blocks carried on messages. Strict
 * upstreams reject unknown message fields, so this has to run for every
 * non-Anthropic provider. An assistant turn that consisted only of a tool
 * search is left with nothing to say, so it is dropped rather than forwarded
 * as an empty message that providers reject.
 */
export function stripAnthropicNativeBlocks(
	messages: BaseMessage[],
): BaseMessage[] {
	return messages.flatMap((message) => {
		if (message.anthropic_native_blocks === undefined) {
			return [message];
		}
		const { anthropic_native_blocks: _dropped, ...rest } = message;
		const isEmpty =
			(rest.content === undefined ||
				rest.content === null ||
				rest.content === "" ||
				(Array.isArray(rest.content) && rest.content.length === 0)) &&
			(!rest.tool_calls || rest.tool_calls.length === 0);
		return isEmpty ? [] : [rest];
	});
}
