import type { WebSearchFormat, WebSearchTool } from "@llmgateway/models";

/**
 * Prompt tokens a chat template may add on top of the request itself: role
 * markers, plus the tool definitions an upstream injects for a hosted search
 * tool (~500 tokens on Qwen).
 */
const TEMPLATE_TOKEN_ALLOWANCE = 4096;

/**
 * Forward a web search to an OpenAI-compatible Chat Completions body in the
 * shape the mapping declares. `allowRequiredToolChoice` is false when the
 * mapping does not accept `tool_choice: "required"`, the Chat Completions way
 * to demand a tool call, which is what a forced search maps to in the tool
 * shape. Only while web search is the sole tool: next to the caller's
 * functions, "required" could be met by calling one of those instead, so the
 * choice stays with the model. `web_search_options` has no forced mode either.
 */
export function applyWebSearchFormat(
	requestBody: Record<string, any>,
	webSearchTool: WebSearchTool,
	format: WebSearchFormat,
	allowRequiredToolChoice: boolean,
): void {
	const { user_location: location, search_context_size: contextSize } =
		webSearchTool;
	const otherTools = requestBody.tools?.length > 0;
	if (format === "web_search_options") {
		requestBody.web_search_options = {
			...(contextSize && { search_context_size: contextSize }),
			...(location && {
				user_location: {
					type: "approximate",
					approximate: {
						city: location.city,
						region: location.region,
						country: location.country,
						timezone: location.timezone,
					},
				},
			}),
		};
		return;
	}
	requestBody.tools = [
		...(requestBody.tools ?? []),
		{
			type: "web_search",
			...(contextSize && { search_context_size: contextSize }),
			...(location && {
				user_location: { ...location, type: "approximate" },
			}),
		},
	];
	if (
		webSearchTool.forced &&
		allowRequiredToolChoice &&
		!otherTools &&
		requestBody.tool_choice === undefined
	) {
		requestBody.tool_choice = "required";
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MEDIA_PART_TYPES = new Set([
	"image_url",
	"input_image",
	"input_audio",
	"video_url",
	"file",
	"input_file",
]);

function containsMedia(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(containsMedia);
	}
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.type === "string" && MEDIA_PART_TYPES.has(value.type)) {
		return true;
	}
	return Object.values(value).some(containsMedia);
}

function hasUrlCitation(annotations: unknown): boolean {
	return (
		Array.isArray(annotations) &&
		annotations.some(
			(annotation) =>
				isRecord(annotation) && annotation.type === "url_citation",
		)
	);
}

/**
 * Searches an OpenAI-compatible chat completion, or one streamed chunk of it,
 * reports outright: `url_citation` annotations on a message or delta count as
 * one search, and a usage counter (`server_tool_use.web_search_requests`,
 * `num_search_queries`) as many as it says.
 */
export function reportedWebSearchCount(response: unknown): number {
	if (!isRecord(response)) {
		return 0;
	}
	let count = 0;
	const usage = response.usage;
	if (isRecord(usage)) {
		for (const value of [
			usage.server_tool_use?.web_search_requests,
			usage.num_search_queries,
		]) {
			if (typeof value === "number" && value > count) {
				count = value;
			}
		}
	}
	if (
		count === 0 &&
		Array.isArray(response.choices) &&
		response.choices.some(
			(choice: unknown) =>
				isRecord(choice) &&
				(hasUrlCitation(choice.message?.annotations) ||
					hasUrlCitation(choice.delta?.annotations)),
		)
	) {
		count = 1;
	}
	return count;
}

/**
 * Billable hosted-tool operations DeepSeek reports in
 * `usage.server_tool_use.tool_search` / `tool_fetch` (Responses and Anthropic
 * APIs): successful searches plus page fetches, both billed per call.
 * Undefined when neither counter is present, so callers fall back to counting
 * result items, which include failed and empty searches. With
 * `alwaysReported` (the upstream omits the counters when nothing billable
 * ran), a `usage` object without them counts zero.
 */
export function billedServerToolUseCount(
	usage: unknown,
	alwaysReported = false,
): number | undefined {
	if (!isRecord(usage)) {
		return undefined;
	}
	const counters = isRecord(usage.server_tool_use)
		? [usage.server_tool_use.tool_search, usage.server_tool_use.tool_fetch]
		: [];
	if (!counters.some((value) => typeof value === "number")) {
		return alwaysReported ? 0 : undefined;
	}
	let count = 0;
	for (const value of counters) {
		if (typeof value === "number" && value > 0) {
			count += value;
		}
	}
	return count;
}

/**
 * Whether the upstream reported more prompt tokens than the text-only request
 * it was sent could encode to. No tokenizer emits more than one token per
 * UTF-8 byte, so the excess is content the upstream added to the prompt — on
 * a search, the retrieved pages. Some endpoints (e.g. SCX with the tool shape)
 * return no citation or usage field at all, and this is the only trace a
 * search leaves. Undecidable, so false, when the request carries images, audio,
 * video or files, whose token counts do not follow their byte size.
 */
export function promptTokensShowSearchContext(
	promptTokens: number | null | undefined,
	requestBody: unknown,
): boolean {
	if (
		typeof promptTokens !== "number" ||
		requestBody instanceof FormData ||
		containsMedia(requestBody)
	) {
		return false;
	}
	const bytes = new TextEncoder().encode(JSON.stringify(requestBody)).length;
	return promptTokens > bytes + TEMPLATE_TOKEN_ALLOWANCE;
}
