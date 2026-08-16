import type {
	AnthropicNativeBlock,
	BaseMessage,
	OpenAIToolInput,
	OpenAIToolSearchToolInput,
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
	return provider === "anthropic" || provider === "vertex-anthropic";
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
 * them (`defer_loading` is an unknown property, and the tool search tool has no
 * counterpart at all).
 */
export function stripAnthropicToolExtensions(
	tools: OpenAIToolInput[] | undefined,
): OpenAIToolInput[] | undefined {
	if (!tools) {
		return tools;
	}
	return tools
		.filter((tool) => !isToolSearchTool(tool))
		.map((tool) => {
			if (tool.type !== "function" || tool.defer_loading === undefined) {
				return tool;
			}
			const { defer_loading: _deferLoading, ...rest } = tool;
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
