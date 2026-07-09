import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";

export type ModelCategoryFilter =
	| "text"
	| "text-to-image"
	| "image-to-image"
	| "video"
	| "embedding"
	| "web-search"
	| "vision"
	| "reasoning"
	| "tools"
	| "discounted"
	| "roleplay"
	| "coding"
	| "creative-writing"
	| "translation"
	| "math"
	| "long-context"
	| "cheapest"
	| "open-source";

export const LONG_CONTEXT_MIN_TOKENS = 200_000;
export const CHEAPEST_MAX_INPUT_PRICE_PER_M = 0.2;
export const CHEAPEST_MAX_OUTPUT_PRICE_PER_M = 1.5;

export const curatedCategoryModelIds: Record<
	"roleplay" | "coding" | "creative-writing" | "translation" | "math",
	ReadonlySet<string>
> = {
	roleplay: new Set([
		"deepseek-v3.2",
		"deepseek-v4-pro",
		"deepseek-v4-flash",
		"grok-4-1-fast-non-reasoning",
		"grok-4-3",
		"kimi-k2",
		"kimi-k2.5",
		"kimi-k2.6",
		"glm-4.7",
		"glm-5",
		"glm-5.2",
		"minimax-m3",
		"minimax-text-01",
		"mistral-large-2512",
		"mistral-small-2506",
		"llama-3.3-70b-instruct",
		"llama-4-maverick-17b-instruct",
		"qwen3-235b-a22b-instruct-2507",
		"claude-sonnet-5",
		"claude-opus-4-8",
	]),
	coding: new Set([
		"claude-fable-5",
		"claude-opus-4-8",
		"claude-sonnet-5",
		"claude-sonnet-4-6",
		"claude-haiku-4-5",
		"gpt-5.3-codex",
		"gpt-5.2-codex",
		"gpt-5.1-codex",
		"gpt-5.1-codex-mini",
		"gpt-5.6-sol",
		"gpt-5.6-terra",
		"gpt-5.5",
		"gpt-5.4",
		"gemini-pro-latest",
		"gemini-3.1-pro-preview",
		"gemini-3.5-flash",
		"grok-build-0-1",
		"grok-4-3",
		"kimi-k2.7-code",
		"kimi-k2.7-code-highspeed",
		"kimi-k2.6",
		"qwen3-coder-plus",
		"qwen3-coder-next",
		"qwen3-coder-480b-a35b-instruct",
		"qwen3-coder-30b-a3b-instruct",
		"qwen3-coder-flash",
		"codestral-2508",
		"devstral-2512",
		"devstral-small-2507",
		"deepseek-v4-pro",
		"deepseek-v3.2",
		"glm-5.2",
		"glm-5.1",
		"glm-4.7",
		"minimax-m3",
		"minimax-m2.7",
	]),
	"creative-writing": new Set([
		"claude-opus-4-8",
		"claude-sonnet-5",
		"claude-fable-5",
		"kimi-k2.5",
		"kimi-k2.6",
		"kimi-k2",
		"gpt-5.6-sol",
		"gpt-5.5",
		"gpt-5-chat-latest",
		"gemini-pro-latest",
		"gemini-3.1-pro-preview",
		"deepseek-v4-pro",
		"minimax-m3",
		"glm-5.2",
		"mistral-large-2512",
		"grok-4-3",
		"llama-4-maverick-17b-instruct",
		"qwen3.7-max",
	]),
	translation: new Set([
		"gemini-3.1-pro-preview",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gpt-5.6-terra",
		"gpt-5.6-luna",
		"gpt-5.4",
		"gpt-5.4-mini",
		"claude-sonnet-5",
		"claude-haiku-4-5",
		"qwen3.7-max",
		"qwen3.7-plus",
		"qwen3-235b-a22b-instruct-2507",
		"deepseek-v4-flash",
		"mistral-large-2512",
		"seed-1-8-251228",
		"gemma-4-31b-it",
		"kimi-k2.6",
	]),
	math: new Set([
		"gpt-5.6-sol",
		"gpt-5.5-pro",
		"gpt-5.5",
		"gpt-5.4-pro",
		"gpt-5.2-pro",
		"o4-mini",
		"claude-opus-4-8",
		"claude-fable-5",
		"gemini-3.1-pro-preview",
		"gemini-pro-latest",
		"deepseek-v4-pro",
		"qwen3-235b-a22b-thinking-2507",
		"qwen3.6-max-preview",
		"glm-5.2",
		"kimi-k2-thinking",
		"minimax-m3",
		"grok-4-20-reasoning",
		"grok-4-3",
		"mimo-v2.5-pro",
	]),
};

export const OPEN_SOURCE_FAMILIES: ReadonlySet<string> = new Set([
	"meta",
	"deepseek",
	"moonshot",
	"minimax",
	"nousresearch",
	"nvidia",
	"xiaomi",
	"zai",
]);

export const OPEN_SOURCE_MODEL_IDS: ReadonlySet<string> = new Set([
	"gpt-oss-120b",
	"gpt-oss-20b",
	"gemma-4-31b-it",
	"gemma-4-26b-a4b-it",
	"mistral-small-2506",
	"devstral-2512",
	"devstral-small-2507",
	"qwen3-235b-a22b-instruct-2507",
	"qwen3-235b-a22b-thinking-2507",
	"qwen3-235b-a22b-fp8",
	"qwen3-32b",
	"qwen3-30b-a3b-instruct-2507",
	"qwen3-4b-fp8",
	"qwen3-next-80b-a3b-thinking",
	"qwen3-next-80b-a3b-instruct",
	"qwen3-coder-480b-a35b-instruct",
	"qwen3-coder-30b-a3b-instruct",
	"qwen3-vl-8b-instruct",
	"qwen3-vl-30b-a3b-instruct",
	"qwen3-vl-30b-a3b-thinking",
	"qwen3-vl-235b-a22b-instruct",
	"qwen3-vl-235b-a22b-thinking",
	"qwen2-5-vl-72b-instruct",
	"qwen2-5-vl-32b-instruct",
	"qwen3.5-9b",
	"qwen3.6-35b-a3b",
]);

export function isTextOutput(output: string[] | null | undefined): boolean {
	return (
		!output?.includes("image") &&
		!output?.includes("video") &&
		!output?.includes("embedding")
	);
}

function isCheapMapping(mapping: ApiModelProviderMapping): boolean {
	if (mapping.inputPrice === null || mapping.outputPrice === null) {
		return false;
	}
	return (
		parseFloat(mapping.inputPrice) * 1e6 <= CHEAPEST_MAX_INPUT_PRICE_PER_M &&
		parseFloat(mapping.outputPrice) * 1e6 <= CHEAPEST_MAX_OUTPUT_PRICE_PER_M
	);
}

export function applyCategoryFilter(
	categoryFilter: ModelCategoryFilter | undefined,
	model: ApiModel,
	mappings: ApiModelProviderMapping[],
): boolean {
	switch (categoryFilter) {
		case "text":
			return isTextOutput(model.output);
		case "text-to-image":
			return model.output?.includes("image") === true;
		case "image-to-image":
			return (
				model.output?.includes("image") === true &&
				mappings.some((m) => m.vision)
			);
		case "video":
			return model.output?.includes("video") === true;
		case "embedding":
			return model.output?.includes("embedding") === true;
		case "web-search":
			return mappings.some((m) => m.webSearch);
		case "vision":
			return mappings.some((m) => m.vision);
		case "reasoning":
			return mappings.some((m) => m.reasoning);
		case "tools":
			return mappings.some((m) => m.tools);
		case "discounted":
			return mappings.some((m) => m.discount && parseFloat(m.discount) > 0);
		case "roleplay":
		case "coding":
		case "creative-writing":
		case "translation":
		case "math":
			return curatedCategoryModelIds[categoryFilter].has(model.id);
		case "long-context":
			return (
				isTextOutput(model.output) &&
				mappings.some((m) => (m.contextSize ?? 0) >= LONG_CONTEXT_MIN_TOKENS)
			);
		case "cheapest":
			return (
				isTextOutput(model.output) &&
				(model.free === true || mappings.some(isCheapMapping))
			);
		case "open-source":
			return (
				isTextOutput(model.output) &&
				(OPEN_SOURCE_FAMILIES.has(model.family) ||
					OPEN_SOURCE_MODEL_IDS.has(model.id))
			);
		default:
			return true;
	}
}
