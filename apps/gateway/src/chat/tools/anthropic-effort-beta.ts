import type {
	AnthropicRequestBody,
	ProviderRequestBody,
} from "@llmgateway/models";

/**
 * Anthropic's `effort-2025-11-24` beta unlocks effort-based reasoning, i.e. the
 * `thinking: { type: "adaptive" }` + `output_config.effort` request fields.
 * `prepareRequestBody` emits those fields both for the explicit `effort` request
 * param and when a standard OpenAI `reasoning_effort` is mapped onto an adaptive
 * model (Opus 4.7+). The beta header must accompany the body in either case —
 * without it Anthropic silently ignores the fields and the model performs no
 * reasoning at all.
 *
 * `output_config` is also used for structured outputs (`output_config.format`),
 * which relies on a different beta, so we key specifically off `output_config.effort`.
 */
export function anthropicRequestNeedsEffortBeta(
	usedProvider: string,
	requestBody: ProviderRequestBody | FormData,
): boolean {
	if (usedProvider !== "anthropic" || requestBody instanceof FormData) {
		return false;
	}
	const body = requestBody as AnthropicRequestBody;
	return (
		body.thinking?.type === "adaptive" ||
		body.output_config?.effort !== undefined
	);
}

/**
 * Betas the Anthropic API needs for tool-level fields the body carries:
 * `strict` rides on structured outputs, `allowed_callers` on programmatic tool
 * calling. Both are ignored, or rejected, without their header.
 */
export function anthropicToolBetas(
	usedProvider: string,
	requestBody: ProviderRequestBody | FormData,
): string[] {
	if (usedProvider !== "anthropic" || requestBody instanceof FormData) {
		return [];
	}
	const tools = (requestBody as AnthropicRequestBody).tools ?? [];
	const betas: string[] = [];
	if (tools.some((tool) => tool.strict === true)) {
		betas.push("structured-outputs-2025-11-13");
	}
	if (tools.some((tool) => tool.allowed_callers !== undefined)) {
		betas.push("advanced-tool-use-2025-11-20");
	}
	return betas;
}

/** Append a beta to `anthropic-beta`, keeping the header free of duplicates. */
export function appendAnthropicBeta(
	headers: Record<string, string>,
	beta: string,
): void {
	const current = headers["anthropic-beta"];
	if (!current) {
		headers["anthropic-beta"] = beta;
		return;
	}
	if (!current.split(",").some((entry) => entry.trim() === beta)) {
		headers["anthropic-beta"] = `${current},${beta}`;
	}
}
