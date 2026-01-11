/**
 * Helper function to normalize usage object for OpenAI SDK compatibility
 * Extracts reasoning_tokens from completion_tokens_details to top level
 * and removes non-standard fields that could cause validation errors
 */
function normalizeUsage(usage: any): any {
	if (!usage) {
		return usage;
	}

	const normalizedUsage: any = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
	};

	// Extract reasoning_tokens from completion_tokens_details if present
	// This handles providers like Cerebras/GLM that nest it differently
	if (usage.completion_tokens_details?.reasoning_tokens !== undefined) {
		normalizedUsage.reasoning_tokens =
			usage.completion_tokens_details.reasoning_tokens;
	}

	// Preserve top-level reasoning_tokens if already present
	if (usage.reasoning_tokens !== undefined) {
		normalizedUsage.reasoning_tokens = usage.reasoning_tokens;
	}

	// Preserve prompt_tokens_details if present
	if (usage.prompt_tokens_details) {
		normalizedUsage.prompt_tokens_details = usage.prompt_tokens_details;
	}

	// Note: We intentionally don't pass through completion_tokens_details
	// as it may contain non-standard fields (accepted_prediction_tokens,
	// rejected_prediction_tokens) that cause validation errors in AI SDK

	return normalizedUsage;
}

/**
 * Helper function to transform standard OpenAI streaming format
 */
export function transformOpenaiStreaming(data: any, usedModel: string): any {
	// Helper to transform delta and normalize reasoning_content to reasoning
	const transformDelta = (delta: any): any => {
		if (!delta) {
			return delta;
		}

		const newDelta = {
			...delta,
			role: delta.role || "assistant",
		};

		// Normalize reasoning_content field to reasoning for OpenAI compatibility
		if (newDelta.reasoning_content) {
			const { reasoning_content, ...rest } = newDelta;
			return {
				...rest,
				reasoning: reasoning_content,
			};
		}

		// Preserve annotations (web search citations) if present
		// OpenAI sends these in delta.annotations for web search results
		if (delta.annotations && Array.isArray(delta.annotations)) {
			newDelta.annotations = delta.annotations;
		}

		return newDelta;
	};

	// Transform choices if they exist
	const transformedChoices = data.choices
		? data.choices.map((choice: any) => ({
				...choice,
				delta: transformDelta(choice.delta),
			}))
		: null;

	// If we don't have proper structure, build it
	if (!data.id || !transformedChoices) {
		const delta = data.delta
			? transformDelta(data.delta)
			: transformDelta({
					content: data.content || "",
					tool_calls: data.tool_calls || null,
				});

		return {
			id: data.id || `chatcmpl-${Date.now()}`,
			object: "chat.completion.chunk",
			created: data.created || Math.floor(Date.now() / 1000),
			model: data.model || usedModel,
			choices: [
				{
					index: 0,
					delta,
					finish_reason: data.finish_reason || null,
				},
			],
			usage: normalizeUsage(data.usage),
		};
	}

	// Return with transformed choices and ensure object field is set
	return {
		...data,
		object: "chat.completion.chunk",
		choices: transformedChoices,
		usage: normalizeUsage(data.usage),
	};
}
