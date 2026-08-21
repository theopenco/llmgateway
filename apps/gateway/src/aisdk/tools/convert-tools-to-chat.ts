import { isProviderToolType } from "@/aisdk/spec.js";

import type { SpecTool } from "@/aisdk/schemas.js";

/**
 * Provider-defined tool ids that map onto the gateway's native `web_search`
 * tool. These are what `openai.tools.webSearch()`,
 * `openai.tools.webSearchPreview()` and `anthropic.tools.webSearch_*()`
 * serialize to; the AI SDK sends the id, never the provider's own tool name.
 *
 * The set is matched by id and not by the `web_search` name a caller happened
 * to bind the tool to, because the name is caller-chosen (`getTools()` in an
 * app can register the same tool under any key).
 */
const WEB_SEARCH_TOOL_IDS = new Set([
	"openai.web_search",
	"openai.web_search_preview",
	"anthropic.web_search_20250305",
	"anthropic.web_search_20260209",
	"google.google_search",
	"llmgateway.web_search",
]);

export interface WebSearchToolRequest {
	type: "web_search";
	user_location?: {
		city?: string;
		region?: string;
		country?: string;
		timezone?: string;
	};
	search_context_size?: "low" | "medium" | "high";
	max_uses?: number;
	allowed_domains?: string[];
	blocked_domains?: string[];
}

export interface ChatFunctionTool {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export interface ConvertToolsResult {
	tools: (ChatFunctionTool | WebSearchToolRequest)[] | undefined;
	tool_choice:
		| "auto"
		| "none"
		| "required"
		| { type: "function"; function: { name: string } }
		| undefined;
	/**
	 * Name the caller bound the web-search tool to, if any. Result parts are
	 * emitted under this name so the client's `tool-<name>` UI part matches.
	 */
	webSearchToolName?: string;
	/** Provider tools we could not map, for `unsupported-tool` warnings. */
	unsupportedTools: SpecTool[];
}

function convertWebSearchArgs(args: Record<string, unknown>) {
	const filters = (args.filters ?? {}) as {
		allowedDomains?: string[];
		blockedDomains?: string[];
	};
	const userLocation = args.userLocation as
		| { city?: string; region?: string; country?: string; timezone?: string }
		| undefined;

	const converted: WebSearchToolRequest = { type: "web_search" };

	if (userLocation) {
		const { city, region, country, timezone } = userLocation;
		converted.user_location = {
			...(city && { city }),
			...(region && { region }),
			...(country && { country }),
			...(timezone && { timezone }),
		};
	}
	if (
		args.searchContextSize === "low" ||
		args.searchContextSize === "medium" ||
		args.searchContextSize === "high"
	) {
		converted.search_context_size = args.searchContextSize;
	}
	if (typeof args.maxUses === "number") {
		converted.max_uses = args.maxUses;
	}
	if (Array.isArray(filters.allowedDomains)) {
		converted.allowed_domains = filters.allowedDomains;
	}
	if (Array.isArray(filters.blockedDomains)) {
		converted.blocked_domains = filters.blockedDomains;
	}

	return converted;
}

/**
 * Converts spec tools into chat-completions tools.
 *
 * Function tools map 1:1. Provider tools are server-executed by the upstream
 * provider — only web search has a gateway equivalent today, so a known
 * web-search id becomes the native `web_search` tool and anything else is
 * reported back as an `unsupported-tool` warning rather than rejected, which is
 * what a real provider does when it does not recognise a provider tool.
 */
export function convertToolsToChat(
	tools: SpecTool[] | undefined,
	toolChoice:
		| { type: "auto" | "none" | "required" | "tool"; toolName?: string }
		| undefined,
): ConvertToolsResult {
	const converted: (ChatFunctionTool | WebSearchToolRequest)[] = [];
	const unsupportedTools: SpecTool[] = [];
	let webSearchToolName: string | undefined;

	for (const tool of tools ?? []) {
		if (tool.type === "function") {
			converted.push({
				type: "function",
				function: {
					name: tool.name ?? "",
					...(tool.description && { description: tool.description }),
					...(tool.inputSchema && { parameters: tool.inputSchema }),
				},
			});
			continue;
		}

		if (isProviderToolType(tool.type) && tool.id) {
			if (WEB_SEARCH_TOOL_IDS.has(tool.id)) {
				converted.push(convertWebSearchArgs(tool.args ?? {}));
				webSearchToolName = tool.name ?? "web_search";
				continue;
			}
			unsupportedTools.push(tool);
			continue;
		}

		unsupportedTools.push(tool);
	}

	let chatToolChoice: ConvertToolsResult["tool_choice"];
	switch (toolChoice?.type) {
		case "auto":
			chatToolChoice = "auto";
			break;
		case "none":
			chatToolChoice = "none";
			break;
		case "required":
			chatToolChoice = "required";
			break;
		case "tool":
			chatToolChoice = toolChoice.toolName
				? { type: "function", function: { name: toolChoice.toolName } }
				: "required";
			break;
		default:
			chatToolChoice = undefined;
	}

	// A tool_choice without tools is rejected by several providers, and the AI
	// SDK always sends `{ type: "auto" }` even when the tool set is empty.
	const hasFunctionTools = converted.some((tool) => tool.type === "function");
	if (!hasFunctionTools && chatToolChoice !== undefined) {
		chatToolChoice = undefined;
	}

	return {
		tools: converted.length > 0 ? converted : undefined,
		tool_choice: chatToolChoice,
		...(webSearchToolName && { webSearchToolName }),
		unsupportedTools,
	};
}
