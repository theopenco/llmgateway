import type {
	AnthropicRequestBody,
	ProviderRequestBody,
} from "@llmgateway/models";

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
