import type {
	ProviderModelMapping,
	ToolChoiceMode,
	ToolChoiceType,
} from "@llmgateway/models";

/**
 * Collapse an OpenAI `tool_choice` value to its coarse mode so it can be
 * checked against a mapping's `supportedToolChoices`. A named function choice
 * (`{type:"function",...}`) maps to "function".
 */
export function toolChoiceModeOf(
	toolChoice: ToolChoiceType,
): ToolChoiceMode | undefined {
	if (
		toolChoice === "auto" ||
		toolChoice === "none" ||
		toolChoice === "required"
	) {
		return toolChoice;
	}
	if (typeof toolChoice === "object" && toolChoice?.type === "function") {
		return "function";
	}
	return undefined;
}

/**
 * Whether a mapping's upstream accepts the requested `tool_choice` mode.
 *
 * Decided by `supportedToolChoices`, the field curated for exactly this. A
 * mapping may accept further modes only while thinking is off — CanopyWave's
 * DeepSeek V4 deployments 400 with "Thinking mode does not support this
 * tool_choice" on "required" and named functions but honour both once thinking
 * is disabled — so `supportedToolChoicesWithThinkingDisabled` is folded in for
 * those requests.
 *
 * Deliberately ignores `supportedParameters`: those lists are not exhaustive
 * (most omit `tool_choice` while the upstream honours it), so routing must not
 * read anything into their silence. `prepareRequestBody` applies its own
 * `supportedParameters` gate on top of this.
 */
export function mappingSupportsToolChoice(
	mapping: Pick<
		ProviderModelMapping,
		"supportedToolChoices" | "supportedToolChoicesWithThinkingDisabled"
	>,
	toolChoice: ToolChoiceType,
	options?: { thinkingDisabled?: boolean },
): boolean {
	const declaredModes = mapping.supportedToolChoices;
	if (!declaredModes || declaredModes.length === 0) {
		return true;
	}

	const extraModes = mapping.supportedToolChoicesWithThinkingDisabled;
	const supportedModes =
		options?.thinkingDisabled && extraModes?.length
			? [...declaredModes, ...extraModes]
			: declaredModes;

	const mode = toolChoiceModeOf(toolChoice);
	return mode !== undefined && supportedModes.includes(mode);
}
