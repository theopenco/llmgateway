import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export function providerSupportsCachedInput(
	p: Pick<ProviderModelMapping, "cachedInputPrice">,
): boolean {
	return p.cachedInputPrice !== null && p.cachedInputPrice !== undefined;
}

/**
 * Checks if a model qualifies as a "coding model".
 * Coding models have:
 * - Not free
 * - Not unstable/experimental stability
 * - At least one stable provider with:
 *   - JSON output support (jsonOutput OR jsonOutputSchema)
 *   - Tool calling support
 *   - Streaming support
 *   - Cached input pricing
 */
export function isCodingModel(model: ModelDefinition): boolean {
	// Exclude free models
	if (model.free) {
		return false;
	}

	// Exclude unstable/experimental models
	if (model.stability === "unstable" || model.stability === "experimental") {
		return false;
	}

	// Must have at least one provider with coding capabilities
	return model.providers.some((p) => {
		// Check provider-level stability
		if (p.stability === "unstable" || p.stability === "experimental") {
			return false;
		}

		// Must have JSON output support
		const hasJsonOutput = p.jsonOutput === true || p.jsonOutputSchema === true;

		// Must have tool calling
		const hasTools = p.tools === true;

		// Must have streaming (true or "only")
		const hasStreaming = p.streaming !== false;

		// Must have cached input pricing
		const hasCachedInputPrice = providerSupportsCachedInput(p);

		return hasJsonOutput && hasTools && hasStreaming && hasCachedInputPrice;
	});
}
