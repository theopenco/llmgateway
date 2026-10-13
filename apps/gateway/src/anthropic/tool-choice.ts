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
