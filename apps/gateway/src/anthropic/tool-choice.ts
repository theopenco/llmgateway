/**
 * Anthropic Messages `tool_choice` mapped onto the Chat Completions shape the
 * inner /v1/chat/completions call understands, which then translates it back
 * per provider (Anthropic `any`/`tool`, Gemini `functionCallingConfig`, ...).
 */

export type AnthropicToolChoice =
	| { type: "auto"; disable_parallel_tool_use?: boolean }
	| { type: "any"; disable_parallel_tool_use?: boolean }
	| { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
	| { type: "none" };

export type OpenAIToolChoice =
	| "auto"
	| "none"
	| "required"
	| { type: "function"; function: { name: string } };

const ANTHROPIC_TOOL_CHOICE_TYPES = new Set(["auto", "any", "tool", "none"]);

export function isAnthropicToolChoice(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		ANTHROPIC_TOOL_CHOICE_TYPES.has(
			(value as { type?: unknown }).type as string,
		)
	);
}

export function mapAnthropicToolChoice(
	toolChoice: AnthropicToolChoice | undefined,
): OpenAIToolChoice | undefined {
	switch (toolChoice?.type) {
		case "auto":
			return "auto";
		case "any":
			return "required";
		case "none":
			return "none";
		case "tool":
			return { type: "function", function: { name: toolChoice.name } };
		default:
			return undefined;
	}
}
/**
 * Anthropic's `disable_parallel_tool_use` lives on `tool_choice`; chat
 * completions carries the same switch as `parallel_tool_calls: false`, which
 * `prepareRequestBody` folds back onto `tool_choice` for Anthropic upstreams.
 */
export function anthropicToolChoiceDisablesParallelUse(
	toolChoice: AnthropicToolChoice | undefined,
): boolean {
	return (
		toolChoice !== undefined &&
		toolChoice.type !== "none" &&
		toolChoice.disable_parallel_tool_use === true
	);
}
